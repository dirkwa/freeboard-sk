import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { ActiveRadar, RadarAPIService } from './radar-api.service';
import {
  GuardZone,
  guardZoneFromControl,
  radarGuardZones,
  RadarGuardZone,
  radarNoTransmitSectors,
  sectorFromControl,
  sectorReach
} from './guard-zones';
import {
  limitZone,
  sectorControlValue,
  sectorForControl,
  zoneControlValue
} from './guard-zone-edit';

/** A guard zone, or a no-transmit sector: a zone with bearings only, which
 *  reaches from the radar out to its range. */
export type ZoneKind = 'zone' | 'sector';

/** A guard zone or no-transmit sector being drawn or edited on the chart.
 *  While drawing, `zone` is the one the radar holds until the user drags out
 *  a new one. */
export interface ZoneEdit {
  radarId: string;
  controlId: string;
  kind: ZoneKind;
  mode: 'draw' | 'edit';
  zone: GuardZone | undefined;
}

interface PendingZone {
  radarId: string;
  controlId: string;
  zone: GuardZone;
}

// how long a saved zone is shown before the radar reports it back, so a
// radar that adjusts the value it stores does not leave the edit up
const PENDING_TIMEOUT = 5000;
const ANGLE_MATCH = 0.001;
const DISTANCE_MATCH = 0.5;

// The value of a zone that was never set, as the MaYaRa radar starts with it.
const CLEARED_ZONE: GuardZone = {
  startAngle: 0,
  endAngle: 0,
  startDistance: 0,
  endDistance: 0,
  enabled: false
};

function kindOf(radar: ActiveRadar | undefined, controlId: string): ZoneKind {
  return radar?.capabilities?.controls?.[controlId]?.dataType === 'sector'
    ? 'sector'
    : 'zone';
}

function storedIn(
  radar: ActiveRadar | undefined,
  controlId: string
): GuardZone | undefined {
  const value = radar?.controls?.get(controlId);
  return kindOf(radar, controlId) === 'sector'
    ? sectorFromControl(value, sectorReach(radar))
    : guardZoneFromControl(value);
}

function sameZone(a: GuardZone | undefined, b: GuardZone): boolean {
  return (
    !!a &&
    a.enabled === b.enabled &&
    Math.abs(a.startAngle - b.startAngle) < ANGLE_MATCH &&
    Math.abs(a.endAngle - b.endAngle) < ANGLE_MATCH &&
    Math.abs(a.startDistance - b.startDistance) < DISTANCE_MATCH &&
    Math.abs(a.endDistance - b.endDistance) < DISTANCE_MATCH
  );
}

/**
 * Drawing and editing the guard zones and no-transmit sectors of the selected
 * radar. The radar holds them; this keeps only the one being edited, and a
 * saved one until the radar reports it back, so the chart does not jump back
 * to the old one in between.
 */
@Injectable({ providedIn: 'root' })
export class GuardZoneEditService {
  private radarApi = inject(RadarAPIService);

  private _edit = signal<ZoneEdit | undefined>(undefined);
  readonly edit = this._edit.asReadonly();
  private pending = signal<PendingZone | undefined>(undefined);
  private pendingTimer: ReturnType<typeof setTimeout>;
  // the latest change sent or cleared: a failure that comes back after a
  // newer change leaves the newer change's state alone
  private latestChange = 0;

  /** The zones and switched-on sectors to draw: the radar's, with the edited
   *  or just saved one in place of its stored value. */
  readonly zones = computed<RadarGuardZone[]>(() => {
    const radar = this.radarApi.radar();
    const id = radar?.device?.id;
    const zones = [...radarGuardZones(radar), ...radarNoTransmitSectors(radar)];
    const edit = this._edit();
    const pending = this.pending();
    const editing = edit?.radarId === id && !!edit.zone;
    const override = editing
      ? { id: edit.controlId, zone: edit.zone }
      : pending?.radarId === id
        ? { id: pending.controlId, zone: pending.zone }
        : undefined;
    if (!override) {
      return zones;
    }
    const others = zones.filter((z) => z.id !== override.id);
    // a sector switched off is left off the chart unless it is being edited
    const shown =
      editing || override.zone.enabled || kindOf(radar, override.id) === 'zone';
    return (shown ? [...others, override] : others).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  });

  constructor() {
    effect(() => {
      const pending = this.pending();
      const radar = this.radarApi.radar();
      if (
        pending &&
        (radar?.device?.id !== pending.radarId ||
          sameZone(storedIn(radar, pending.controlId), pending.zone))
      ) {
        this.clearPending();
      }
    });
    effect(() => {
      // a radar picked in the panel ends the edit of another radar's zone
      const id = this.radarApi.radar()?.device?.id;
      const edit = this._edit();
      if (edit && edit.radarId !== id) {
        this._edit.set(undefined);
      }
    });
  }

  /** The stored zone of a guard zone or sector control of the selected
   *  radar. */
  storedZone(controlId: string): GuardZone | undefined {
    return storedIn(this.radarApi.radar(), controlId);
  }

  /** Start drawing a zone: the next drag on the chart replaces it. */
  draw(controlId: string) {
    this.start(controlId, 'draw');
  }

  /** Start editing a zone through its handles on the chart. */
  editZone(controlId: string) {
    this.start(controlId, 'edit');
  }

  private start(controlId: string, mode: ZoneEdit['mode']) {
    const radar = this.radarApi.radar();
    const radarId = radar?.device?.id;
    if (!radarId) {
      return;
    }
    const current = this._edit();
    const zone =
      current?.controlId === controlId && current.radarId === radarId
        ? current.zone
        : this.storedZone(controlId);
    const kind = kindOf(radar, controlId);
    this._edit.set({ radarId, controlId, kind, mode, zone });
  }

  /** Replace the edited zone, e.g. while a handle is dragged. */
  update(zone: GuardZone) {
    this._edit.update((e) => (e ? { ...e, zone: this.shape(e, zone) } : e));
  }

  /** A drawn zone is armed and goes on to be adjusted through its handles. */
  drawn(zone: GuardZone) {
    this._edit.update((e) =>
      e
        ? {
            ...e,
            mode: 'edit',
            zone: this.shape(e, { ...zone, enabled: true })
          }
        : e
    );
  }

  /** A sector keeps reaching out to the radar range, however it was drawn. */
  private shape(edit: ZoneEdit, zone: GuardZone): GuardZone {
    return edit.kind === 'sector'
      ? {
          ...zone,
          startDistance: 0,
          endDistance: sectorReach(this.radarApi.radar())
        }
      : zone;
  }

  cancel() {
    this._edit.set(undefined);
  }

  /** Send the edited zone to the radar in one change. */
  async save(): Promise<void> {
    const edit = this._edit();
    if (!edit?.zone) {
      return;
    }
    this._edit.set(undefined);
    const change = ++this.latestChange;
    try {
      await this.send(edit.radarId, edit.controlId, edit.zone, change);
    } catch (err) {
      // the radar kept its old zone, so the user's edit is still unsaved
      if (change === this.latestChange && !this._edit()) {
        this._edit.set(edit);
      }
      throw err;
    }
  }

  /** Arm or disarm a zone as the radar holds it, or as it was just saved. */
  async setEnabled(controlId: string, enabled: boolean): Promise<void> {
    const radarId = this.radarApi.radar()?.device?.id;
    const zone =
      this.pendingZone(radarId, controlId) ?? this.storedZone(controlId);
    if (radarId && zone) {
      await this.send(
        radarId,
        controlId,
        { ...zone, enabled },
        ++this.latestChange
      );
    }
  }

  /** Remove a zone, leaving the radar's control as it is before any zone
   *  was set. */
  async clear(controlId: string): Promise<void> {
    const radarId = this.radarApi.radar()?.device?.id;
    if (!radarId) {
      return;
    }
    ++this.latestChange;
    if (this._edit()?.controlId === controlId) {
      this._edit.set(undefined);
    }
    if (this.pendingZone(radarId, controlId)) {
      this.clearPending();
    }
    await this.radarApi.setControl(
      radarId,
      controlId,
      zoneControlValue(CLEARED_ZONE)
    );
  }

  private async send(
    radarId: string,
    controlId: string,
    zone: GuardZone,
    change: number
  ) {
    const radar = this.radarApi.radar();
    const def = radar?.capabilities?.controls?.[controlId];
    const sector = kindOf(radar, controlId) === 'sector';
    const value = sector
      ? sectorForControl(zone, def)
      : limitZone(zone, def?.maxDistance);
    this.setPending({ radarId, controlId, zone: value });
    try {
      await this.radarApi.setControl(
        radarId,
        controlId,
        sector ? sectorControlValue(value) : zoneControlValue(value)
      );
    } catch (err) {
      if (change === this.latestChange) {
        this.clearPending();
      }
      throw err;
    }
  }

  private pendingZone(
    radarId: string,
    controlId: string
  ): GuardZone | undefined {
    const pending = this.pending();
    return pending?.radarId === radarId && pending.controlId === controlId
      ? pending.zone
      : undefined;
  }

  private setPending(pending: PendingZone) {
    clearTimeout(this.pendingTimer);
    this.pending.set(pending);
    this.pendingTimer = setTimeout(() => this.clearPending(), PENDING_TIMEOUT);
  }

  private clearPending() {
    clearTimeout(this.pendingTimer);
    this.pending.set(undefined);
  }
}
