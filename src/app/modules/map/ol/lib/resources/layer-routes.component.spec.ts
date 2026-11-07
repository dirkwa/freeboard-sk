import { describe, it, expect, vi, afterEach } from 'vitest';
import { SimpleChange } from '@angular/core';
import { Feature } from 'ol';
import { LineString } from 'ol/geom';
import VectorSource from 'ol/source/Vector';
import type { Style } from 'ol/style';
import type { State } from 'ol/render';
import { FreeboardRouteLayerComponent } from './layer-routes.component';
import { routeStyles } from '../../../mapconfig';
import { FBRoutes } from 'src/app/types';
import { ROUTE_FLOW } from './route-flow';

/**
 * The route layer's direction decoration, driven on a bare prototype (no
 * Angular DI or real map): the style's renderer is called with a recording
 * canvas context, as OpenLayers would call it while drawing a frame.
 */
interface Recorder {
  ctx: CanvasRenderingContext2D;
  /** Path commands of each stroke, in order. */
  strokes: [string, number, number][][];
}

function recorder(): Recorder {
  const strokes: [string, number, number][][] = [];
  let path: [string, number, number][] = [];
  const ctx = {
    canvas: { width: 1000, height: 1000 },
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => (path = []),
    moveTo: (x: number, y: number) => path.push(['M', x, y]),
    lineTo: (x: number, y: number) => path.push(['L', x, y]),
    stroke: () => strokes.push(path)
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

const render = { render: vi.fn() };

function layer(opts: {
  activeRoute?: string;
  activeReversed?: boolean;
  animateFlow?: boolean;
}): FreeboardRouteLayerComponent {
  const c = Object.create(
    FreeboardRouteLayerComponent.prototype
  ) as FreeboardRouteLayerComponent;
  Object.assign(c, {
    mapComponent: { getMap: () => render },
    mapImages: { getExternalSymbol: () => null },
    routeStyles,
    routes: [['r1', {}, true]] as unknown as FBRoutes,
    activeRoute: opts.activeRoute ?? null,
    activeReversed: opts.activeReversed ?? false,
    animateFlow: opts.animateFlow ?? false,
    source: new VectorSource()
  });
  return c;
}

/** Draw route r1, running east along y = 500, and return its chevrons. */
function chevrons(c: FreeboardRouteLayerComponent): [string, number, number][] {
  const feature = new Feature(
    new LineString([
      [100, 500],
      [600, 500]
    ])
  );
  feature.setId('route.r1');
  const styles = c.buildStyle(feature, 1) as Style[];
  const flow = styles.find((s) => s.getRenderer());
  const rec = recorder();
  flow?.getRenderer()?.(
    [
      [100, 500],
      [600, 500]
    ],
    { context: rec.ctx, pixelRatio: 1 } as unknown as State
  );
  // the guide lines are stroked first, then the chevrons (outline and fill)
  return rec.strokes[1];
}

/** +1 when the chevron tips point east, -1 when west. */
function pointing(path: [string, number, number][]): number {
  const [arm, tip] = path;
  return Math.sign(tip[1] - arm[1]);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  render.render.mockReset();
});

describe('FreeboardRouteLayerComponent direction chevrons', () => {
  it('point the way the route runs', () => {
    expect(pointing(chevrons(layer({})))).toBe(1);
  });

  it('point back along a reversed active route', () => {
    const c = layer({ activeRoute: 'r1', activeReversed: true });
    expect(pointing(chevrons(c))).toBe(-1);
  });

  it('ignore the reversal of another route', () => {
    const c = layer({ activeRoute: 'r2', activeReversed: true });
    expect(pointing(chevrons(c))).toBe(1);
  });

  it('start moving when animation is turned on, without a restyle', () => {
    const c = layer({});
    const feature = new Feature(
      new LineString([
        [100, 500],
        [600, 500]
      ])
    );
    feature.setId('route.r1');
    const flow = (c.buildStyle(feature, 1) as Style[]).find((s) =>
      s.getRenderer()
    );
    const firstX = (now: number) => {
      vi.spyOn(performance, 'now').mockReturnValue(now);
      const rec = recorder();
      flow?.getRenderer()?.(
        [
          [100, 500],
          [600, 500]
        ],
        { context: rec.ctx, pixelRatio: 1 } as unknown as State
      );
      return rec.strokes[1][0][1];
    };
    expect(firstX(0)).toBe(firstX(ROUTE_FLOW.periodMs / 4));
    c.animateFlow = true;
    expect(firstX(0)).not.toBe(firstX(ROUTE_FLOW.periodMs / 4));
  });
});

describe('FreeboardRouteLayerComponent flow animation timer', () => {
  it('redraws the map once animation is turned on', () => {
    vi.useFakeTimers();
    const c = layer({});
    c.animateFlow = true;
    c.ngOnChanges({ animateFlow: new SimpleChange(false, true, false) });
    render.render.mockReset();
    vi.advanceTimersByTime(500);
    expect(render.render.mock.calls.length).toBeGreaterThanOrEqual(5);
    c.ngOnDestroy();
  });

  it('stops redrawing when animation is turned off', () => {
    vi.useFakeTimers();
    const c = layer({ animateFlow: true });
    c.ngOnChanges({ animateFlow: new SimpleChange(false, true, false) });
    c.animateFlow = false;
    c.ngOnChanges({ animateFlow: new SimpleChange(true, false, false) });
    render.render.mockReset();
    vi.advanceTimersByTime(500);
    expect(render.render).not.toHaveBeenCalled();
    c.ngOnDestroy();
  });
});
