// Проекция карты (Робинсон, ширина 1600 px) — общая для контуров и точек столиц.
import { geoPath } from "d3-geo";
import { geoRobinson } from "d3-geo-projection";

export const WIDTH = 1600;

export function makeProjection() {
  const projection = geoRobinson().fitWidth(WIDTH, { type: "Sphere" });
  const [[, y0], [, y1]] = geoPath(projection).bounds({ type: "Sphere" });
  projection.translate([projection.translate()[0], projection.translate()[1] - y0]);
  return { projection, height: Math.ceil(y1 - y0) };
}
