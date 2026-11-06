import { describe, expect, it } from 'vitest';
import { passesAisFilter } from './ais-base.component';
import { SKVessel } from 'src/app/modules';

const ID = 'vessels.urn:mrn:imo:mmsi:244060000';

function vessel(typeId: number, buddy = false): SKVessel {
  const v = new SKVessel();
  v.id = ID;
  v.type = { id: typeId, name: '' };
  v.buddy = buddy;
  return v;
}

/** The AIS selections decide which vessels the chart draws. */
describe('passesAisFilter', () => {
  it('draws every vessel without selections', () => {
    expect(passesAisFilter(ID, vessel(36), {})).toBe(true);
  });

  it('draws only the chosen targets', () => {
    expect(passesAisFilter(ID, vessel(36), { filterIds: [ID] })).toBe(true);
    expect(passesAisFilter(ID, vessel(36), { filterIds: [] })).toBe(false);
  });

  it('draws only the chosen ship types when filtering by type', () => {
    const filter = { filterByShipType: true, filterShipTypes: [30] };
    expect(passesAisFilter(ID, vessel(36), filter)).toBe(true);
    expect(passesAisFilter(ID, vessel(70), filter)).toBe(false);
  });

  it('draws only buddies when that is chosen', () => {
    const filter = { filterShipTypes: [-998] };
    expect(passesAisFilter(ID, vessel(36, true), filter)).toBe(true);
    expect(passesAisFilter(ID, vessel(36), filter)).toBe(false);
  });
});
