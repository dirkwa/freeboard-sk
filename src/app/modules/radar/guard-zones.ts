import { computeDestinationPoint } from 'geolib';
import { ActiveRadar, ControlValue } from './radar-api.service';
import { radarRange } from './range-rings';

/** A guard zone: an annular sector around the radar, its bearings relative
 *  to the bow (radians, clockwise) and its distances in metres. Equal start
 *  and end bearings make a full ring. */
export interface GuardZone {
  startAngle: number;
  endAngle: number;
  startDistance: number;
  endDistance: number;
  enabled: boolean;
}

export interface RadarGuardZone {
  /** control id, e.g. `guardZone1` or `noTransmitSector1` */
  id: string;
  zone: GuardZone;
}

/** [longitude, latitude] */
export type LonLat = [number, number];

const GUARD_ZONE_PREFIX = 'guardZone';
const NO_TRANSMIT_SECTOR_PREFIX = 'noTransmitSector';
// how far a no-transmit sector is drawn when the radar reports no range
const DEFAULT_SECTOR_REACH = 1852;
// a sector whose ends are closer than this (radians) is the full ring; the
// same tolerance as the MaYaRa radar's ZONE_ANGLE_EPSILON, so the chart
// draws the zone its ARPA detector applies
const FULL_RING_TOLERANCE = 0.001;
const FULL_TURN = 2 * Math.PI;
// the longest arc step drawn as one straight segment
const MAX_ARC_STEP = (2 * Math.PI) / 180;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** The zone a `zone` control value describes, or undefined when it has none
 *  (a zone never set reports no outer distance) or its inner distance lies
 *  beyond its outer one. */
export function guardZoneFromControl(
  value: ControlValue | undefined
): GuardZone | undefined {
  const startDistance = value?.startDistance ?? 0;
  if (
    !isFiniteNumber(value?.value) ||
    !isFiniteNumber(value.endValue) ||
    !isFiniteNumber(value.endDistance) ||
    !(value.endDistance > 0) ||
    !isFiniteNumber(startDistance) ||
    startDistance > value.endDistance
  ) {
    return undefined;
  }
  return {
    startAngle: value.value,
    endAngle: value.endValue,
    startDistance: Math.max(0, startDistance),
    endDistance: value.endDistance,
    enabled: value.enabled === true
  };
}

/** True for a guard zone control. */
export function isGuardZoneControl(id: string, dataType: string): boolean {
  return id.startsWith(GUARD_ZONE_PREFIX) && dataType === 'zone';
}

/** True for a no-transmit sector control: bearings the radar does not
 *  transmit on, e.g. where a mast or a mizzen blocks the beam. */
export function isNoTransmitSectorControl(
  id: string,
  dataType: string
): boolean {
  return id.startsWith(NO_TRANSMIT_SECTOR_PREFIX) && dataType === 'sector';
}

/** How far out a no-transmit sector is drawn: the radar's range, since the
 *  radar sees nothing on those bearings at any distance. */
export function sectorReach(radar: ActiveRadar | undefined): number {
  const range = radarRange(radar);
  return range > 0 ? range : DEFAULT_SECTOR_REACH;
}

/** The sector a `sector` control value describes, as a zone from the radar
 *  out to `reach` (m), or undefined when it has none: a sector never set has
 *  no width. */
export function sectorFromControl(
  value: ControlValue | undefined,
  reach: number
): GuardZone | undefined {
  if (
    !isFiniteNumber(value?.value) ||
    !isFiniteNumber(value.endValue) ||
    Math.abs(value.endValue - value.value) < FULL_RING_TOLERANCE
  ) {
    return undefined;
  }
  return {
    startAngle: value.value,
    endAngle: value.endValue,
    startDistance: 0,
    endDistance: reach,
    enabled: value.enabled === true
  };
}

/** The guard zones of a radar, in control id order. */
export function radarGuardZones(
  radar: ActiveRadar | undefined
): RadarGuardZone[] {
  if (!radar?.capabilities?.controls || !radar.controls) {
    return [];
  }
  return Object.entries(radar.capabilities.controls)
    .filter(([id, def]) => isGuardZoneControl(id, def.dataType))
    .map(([id]) => ({ id, zone: guardZoneFromControl(radar.controls.get(id)) }))
    .filter((z) => z.zone !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The no-transmit sectors a radar has switched on, in control id order. */
export function radarNoTransmitSectors(
  radar: ActiveRadar | undefined
): RadarGuardZone[] {
  if (!radar?.capabilities?.controls || !radar.controls) {
    return [];
  }
  const reach = sectorReach(radar);
  return Object.entries(radar.capabilities.controls)
    .filter(([id, def]) => isNoTransmitSectorControl(id, def.dataType))
    .map(([id]) => ({
      id,
      zone: sectorFromControl(radar.controls.get(id), reach)
    }))
    .filter((z) => z.zone?.enabled)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** True when the zone covers every bearing: its ends coincide, or it
 *  sweeps a whole turn. */
export function isFullRing(zone: GuardZone): boolean {
  const span = Math.abs(zone.endAngle - zone.startAngle);
  return span < FULL_RING_TOLERANCE || span >= FULL_TURN;
}

/**
 * The zone's outline as polygon rings in [lon, lat], placed around `position`
 * and turned by the vessel's `heading` (radians, true), since the zone's
 * bearings are relative to the bow. A full ring with an inner distance is an
 * outer ring with a hole; a sector runs clockwise from its start bearing to
 * its end bearing.
 */
export function guardZoneRings(
  position: ArrayLike<number>,
  heading: number,
  zone: GuardZone
): LonLat[][] {
  const point = (bearing: number, distance: number): LonLat => {
    if (distance <= 0) {
      return [position[0], position[1]];
    }
    const p = computeDestinationPoint(
      { longitude: position[0], latitude: position[1] },
      distance,
      ((heading + bearing) * 180) / Math.PI
    );
    return [p.longitude, p.latitude];
  };
  const arc = (from: number, sweep: number, distance: number): LonLat[] => {
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_ARC_STEP));
    const points: LonLat[] = [];
    for (let i = 0; i <= steps; i++) {
      points.push(point(from + (sweep * i) / steps, distance));
    }
    return points;
  };

  if (isFullRing(zone)) {
    const outer = arc(0, FULL_TURN, zone.endDistance);
    return zone.startDistance > 0
      ? [outer, arc(0, -FULL_TURN, zone.startDistance)]
      : [outer];
  }

  const sweep =
    (((zone.endAngle - zone.startAngle) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const ring = arc(zone.startAngle, sweep, zone.endDistance);
  if (zone.startDistance > 0) {
    ring.push(...arc(zone.endAngle, -sweep, zone.startDistance));
  } else {
    ring.push(point(0, 0));
  }
  ring.push(ring[0]);
  return [ring];
}
