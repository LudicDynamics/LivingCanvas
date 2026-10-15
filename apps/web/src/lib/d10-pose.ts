import { Matrix4, Quaternion, Vector3 } from 'three';

/** Face bases match the numbered faces in assets/models/arcane-d10/noctiluca-d10.glb. */
export function d10FaceBasis(digit: number): { normal: Vector3; up: Vector3 } {
  const numbers = [0, 7, 4, 1, 6, 8, 3, 9, 2, 5];
  const index = numbers.indexOf(digit);
  if (index < 0) throw new Error('D10 digit must be 0–9');

  const h = 1.35 * (1 - Math.cos(Math.PI / 5)) / (1 + Math.cos(Math.PI / 5));
  const pole = new Vector3(0, 0, index < 5 ? 1.35 : -1.35);
  const ring = (ringIndex: number) => new Vector3(
    1.1 * Math.cos(ringIndex * Math.PI / 5),
    1.1 * Math.sin(ringIndex * Math.PI / 5),
    ringIndex % 2 === 0 ? h : -h,
  );
  const ringIndex = index < 5 ? index * 2 : (index - 5) * 2 + 1;
  const points = [pole, ring(ringIndex), ring((ringIndex + 1) % 10), ring((ringIndex + 2) % 10)];
  const center = points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(0.25);
  const normal = points[1].clone().sub(pole).cross(points[2].clone().sub(pole)).normalize();
  if (normal.dot(center) < 0) normal.negate();
  const up = pole.clone().sub(center).normalize();
  const convert = (value: Vector3) => new Vector3(value.x, value.z, -value.y);
  return { normal: convert(normal), up: convert(up) };
}

/** Rotate a selected numeral toward the camera while keeping it upright. */
export function d10Landing(digit: number): Quaternion {
  const { normal, up } = d10FaceBasis(digit);
  const right = up.clone().cross(normal).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal)).invert();
}
