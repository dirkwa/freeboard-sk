import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuardZoneEditService } from './guard-zone-edit.service';
import { GuardZone } from './guard-zones';
import {
  ActiveRadar,
  CapabilityManifest,
  ControlValue,
  RadarAPIService
} from './radar-api.service';

describe('GuardZoneEditService', () => {
  const zoneDef = (id: number) => ({
    id,
    name: 'Guard zone',
    description: '',
    category: 'guardZones',
    dataType: 'zone',
    maxDistance: 5000
  });
  const stored: ControlValue = {
    value: 0,
    endValue: 1,
    startDistance: 100,
    endDistance: 800,
    enabled: true
  };
  const drawn: GuardZone = {
    startAngle: -0.5,
    endAngle: 0.5,
    startDistance: 200,
    endDistance: 1200,
    enabled: false
  };

  let radar: WritableSignal<ActiveRadar>;
  let setControl: ReturnType<typeof vi.fn>;
  let service: GuardZoneEditService;

  const makeRadar = (
    id: string,
    values: Record<string, ControlValue>
  ): ActiveRadar => ({
    device: { id, name: id, brand: 'Furuno' },
    capabilities: {
      controls: { guardZone1: zoneDef(16), guardZone2: zoneDef(17) }
    } as unknown as CapabilityManifest,
    controls: new Map(Object.entries(values))
  });
  const report = (controlId: string, value: ControlValue) =>
    radar.update((r) => ({
      ...r,
      controls: new Map(r.controls).set(controlId, value)
    }));
  const shown = (id: string) => service.zones().find((z) => z.id === id)?.zone;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    radar = signal(
      makeRadar('fur6424A', {
        guardZone1: stored,
        guardZone2: { value: 0, endValue: 0, startDistance: 0, endDistance: 0 }
      })
    );
    setControl = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: RadarAPIService, useValue: { radar, setControl } }]
    });
    service = TestBed.inject(GuardZoneEditService);
  });

  afterEach(() => vi.useRealTimers());

  it('shows the zone being drawn in place of the stored one', () => {
    service.draw('guardZone1');
    expect(shown('guardZone1').endDistance).toBe(800);
    service.update(drawn);
    expect(shown('guardZone1')).toEqual(drawn);
  });

  it('shows a zone drawn where the radar holds none', () => {
    expect(shown('guardZone2')).toBeUndefined();
    service.draw('guardZone2');
    service.update(drawn);
    expect(shown('guardZone2')).toEqual(drawn);
  });

  it('arms a drawn zone and goes on to edit it', () => {
    service.draw('guardZone2');
    service.drawn(drawn);
    expect(service.edit().mode).toBe('edit');
    expect(service.edit().zone.enabled).toBe(true);
  });

  it('saves the whole zone in one change, within the radar reach', async () => {
    service.editZone('guardZone1');
    service.update({ ...drawn, endDistance: 9000 });
    await service.save();
    expect(setControl).toHaveBeenCalledTimes(1);
    expect(setControl).toHaveBeenCalledWith('fur6424A', 'guardZone1', {
      value: -0.5,
      endValue: 0.5,
      startDistance: 200,
      endDistance: 5000,
      enabled: false
    });
    expect(service.edit()).toBeUndefined();
  });

  it('keeps showing a saved zone until the radar reports it', async () => {
    service.editZone('guardZone1');
    service.update(drawn);
    await service.save();
    expect(shown('guardZone1')).toEqual(drawn);

    report('guardZone1', {
      value: drawn.startAngle,
      endValue: drawn.endAngle,
      startDistance: drawn.startDistance,
      endDistance: drawn.endDistance,
      enabled: drawn.enabled
    });
    TestBed.tick();
    // the radar's own value is shown from now on
    report('guardZone1', stored);
    expect(shown('guardZone1').endDistance).toBe(800);
  });

  it('stops showing a saved zone the radar never reports back', async () => {
    service.editZone('guardZone1');
    service.update(drawn);
    await service.save();
    vi.advanceTimersByTime(5000);
    expect(shown('guardZone1').endDistance).toBe(800);
  });

  it('keeps the edit when saving fails', async () => {
    setControl.mockRejectedValueOnce(new Error('rejected'));
    service.editZone('guardZone1');
    service.update(drawn);
    await expect(service.save()).rejects.toThrow('rejected');
    expect(service.edit()).toMatchObject({
      controlId: 'guardZone1',
      mode: 'edit',
      zone: drawn
    });
    expect(shown('guardZone1')).toEqual(drawn);
  });

  it('lets a change made while a save is on its way outlast the save failing', async () => {
    let reject: (err: Error) => void;
    setControl.mockImplementationOnce(
      () => new Promise((_, r) => (reject = r))
    );
    service.editZone('guardZone1');
    service.update(drawn);
    const saving = service.save();
    await service.setEnabled('guardZone1', true);
    reject(new Error('rejected'));
    await expect(saving).rejects.toThrow('rejected');

    expect(service.edit()).toBeUndefined();
    expect(shown('guardZone1')).toEqual({ ...drawn, enabled: true });
  });

  it('arms and disarms the stored zone', async () => {
    await service.setEnabled('guardZone1', false);
    expect(setControl).toHaveBeenCalledWith('fur6424A', 'guardZone1', {
      value: 0,
      endValue: 1,
      startDistance: 100,
      endDistance: 800,
      enabled: false
    });
  });

  it('arms and disarms a saved zone the radar has not reported yet', async () => {
    service.editZone('guardZone1');
    service.update(drawn);
    await service.save();
    await service.setEnabled('guardZone1', true);
    expect(setControl).toHaveBeenLastCalledWith('fur6424A', 'guardZone1', {
      value: -0.5,
      endValue: 0.5,
      startDistance: 200,
      endDistance: 1200,
      enabled: true
    });
  });

  it('stops showing a saved zone that is cleared', async () => {
    service.editZone('guardZone2');
    service.update(drawn);
    await service.save();
    await service.clear('guardZone2');
    expect(shown('guardZone2')).toBeUndefined();
  });

  it('clears a zone to the value of a zone never set', async () => {
    await service.clear('guardZone1');
    expect(setControl).toHaveBeenCalledWith('fur6424A', 'guardZone1', {
      value: 0,
      endValue: 0,
      startDistance: 0,
      endDistance: 0,
      enabled: false
    });
  });

  it('ends the edit when another radar is picked', () => {
    service.editZone('guardZone1');
    radar.set(makeRadar('fur6424B', { guardZone1: stored }));
    TestBed.tick();
    expect(service.edit()).toBeUndefined();
  });

  describe('no-transmit sectors', () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    const sectorDef = {
      id: 40,
      name: 'No transmit sector 1',
      description: '',
      category: 'installation',
      dataType: 'sector',
      minValue: -Math.PI,
      maxValue: Math.PI,
      stepValue: deg(1)
    };
    const sector: ControlValue = {
      value: deg(100),
      endValue: deg(130),
      enabled: false
    };

    beforeEach(() => {
      radar.update((r) => ({
        ...r,
        capabilities: {
          controls: {
            ...r.capabilities.controls,
            noTransmitSector1: sectorDef
          }
        } as unknown as CapabilityManifest,
        controls: new Map(r.controls)
          .set('range', { value: 3704 })
          .set('noTransmitSector1', sector)
      }));
    });

    it('leaves a sector switched off off the chart, until it is edited', () => {
      expect(shown('noTransmitSector1')).toBeUndefined();
      service.editZone('noTransmitSector1');
      expect(service.edit().kind).toBe('sector');
      expect(shown('noTransmitSector1')).toEqual({
        startAngle: deg(100),
        endAngle: deg(130),
        startDistance: 0,
        endDistance: 3704,
        enabled: false
      });
    });

    it('keeps a drawn sector reaching out to the radar range', () => {
      service.draw('noTransmitSector1');
      service.drawn(drawn);
      expect(service.edit().zone).toEqual({
        startAngle: drawn.startAngle,
        endAngle: drawn.endAngle,
        startDistance: 0,
        endDistance: 3704,
        enabled: true
      });
    });

    it('saves the bearings only, on the radar step', async () => {
      service.editZone('noTransmitSector1');
      service.update({
        ...service.edit().zone,
        startAngle: deg(99.6),
        enabled: true
      });
      await service.save();
      expect(setControl).toHaveBeenCalledWith('fur6424A', 'noTransmitSector1', {
        value: expect.closeTo(deg(100)),
        endValue: expect.closeTo(deg(130)),
        enabled: true
      });
      expect(shown('noTransmitSector1').enabled).toBe(true);
    });

    it('switches a sector on as the radar holds it', async () => {
      await service.setEnabled('noTransmitSector1', true);
      expect(setControl).toHaveBeenCalledWith('fur6424A', 'noTransmitSector1', {
        value: expect.closeTo(deg(100)),
        endValue: expect.closeTo(deg(130)),
        enabled: true
      });
      expect(shown('noTransmitSector1').enabled).toBe(true);
    });

    it('takes a sector switched off off the chart once it is saved', async () => {
      report('noTransmitSector1', { ...sector, enabled: true });
      expect(shown('noTransmitSector1')).toBeDefined();
      await service.setEnabled('noTransmitSector1', false);
      expect(shown('noTransmitSector1')).toBeUndefined();
    });
  });
});
