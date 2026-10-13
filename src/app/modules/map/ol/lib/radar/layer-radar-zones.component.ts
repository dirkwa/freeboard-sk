import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges
} from '@angular/core';
import { Feature } from 'ol';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Polygon } from 'ol/geom';
import { Fill, Stroke, Style } from 'ol/style';
import { MapComponent } from '../map.component';
import { Coordinate } from '../models';
import { fromLonLatArray, mapifyCoords } from '../util';
import {
  guardZoneRings,
  RadarGuardZone
} from 'src/app/modules/radar/guard-zones';

// The colours the MaYaRa radar GUI draws its two guard zones and its
// no-transmit sectors in, so a zone reads the same on the chart as on the
// radar screen.
const ZONE_COLOURS: Record<string, [number, number, number]> = {
  guardZone1: [0, 128, 0],
  guardZone2: [0, 0, 255]
};
const SECTOR_COLOUR: [number, number, number] = [200, 200, 0];
const DEFAULT_COLOUR: [number, number, number] = [0, 128, 0];

function zoneColour(id: string): [number, number, number] {
  return (
    ZONE_COLOURS[id] ??
    (id.startsWith('noTransmitSector') ? SECTOR_COLOUR : DEFAULT_COLOUR)
  );
}

/** The style of a guard zone or sector: filled while it is on, a dashed
 *  outline while it is switched off. */
export function guardZoneStyle(zone: RadarGuardZone): Style {
  const [r, g, b] = zoneColour(zone.id);
  return zone.zone.enabled
    ? new Style({
        fill: new Fill({ color: `rgba(${r}, ${g}, ${b}, 0.15)` }),
        stroke: new Stroke({ color: `rgba(${r}, ${g}, ${b}, 0.8)`, width: 2 })
      })
    : new Style({
        stroke: new Stroke({
          color: `rgba(${r}, ${g}, ${b}, 0.5)`,
          width: 1.5,
          lineDash: [6, 6]
        })
      });
}

// ** Freeboard radar guard zones component **
@Component({
  selector: 'ol-map > fb-radar-zones',
  template: '<ng-content></ng-content>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class RadarZonesComponent implements OnInit, OnChanges, OnDestroy {
  @Input() zones: RadarGuardZone[] = [];
  @Input() position: Coordinate;
  /** vessel heading, radians true: the zones' bearings are relative to the bow */
  @Input() heading = 0;
  @Input() zIndex: number;

  protected layer: VectorLayer<VectorSource>;
  protected source: VectorSource;

  constructor(
    protected changeDetectorRef: ChangeDetectorRef,
    protected mapComponent: MapComponent
  ) {
    this.changeDetectorRef.detach();
  }

  ngOnInit() {
    this.source = new VectorSource({ features: this.buildFeatures() });
    this.layer = new VectorLayer({ source: this.source, zIndex: this.zIndex });
    this.mapComponent.getMap()?.addLayer(this.layer);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.layer) {
      return;
    }
    if (changes['zIndex']) {
      this.layer.setZIndex(this.zIndex);
    }
    if (changes['zones'] || changes['position'] || changes['heading']) {
      this.source.clear();
      this.source.addFeatures(this.buildFeatures());
    }
  }

  ngOnDestroy() {
    this.mapComponent.getMap()?.removeLayer(this.layer);
    this.layer = null;
  }

  private buildFeatures(): Feature[] {
    if (!Array.isArray(this.position) || !Array.isArray(this.zones)) {
      return [];
    }
    return this.zones.map((z) => {
      const rings = guardZoneRings(this.position, this.heading ?? 0, z.zone);
      const f = new Feature({
        geometry: new Polygon(
          rings.map((ring) => fromLonLatArray(mapifyCoords(ring)))
        )
      });
      f.setStyle(guardZoneStyle(z));
      return f;
    });
  }
}
