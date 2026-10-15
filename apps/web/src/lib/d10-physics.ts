import { Body, Box, ConvexPolyhedron, Plane, Vec3, World } from 'cannon-es';
import { Quaternion, Vector3 } from 'three';
import { d10FaceBasis, d10Landing } from './d10-pose.js';

export function d10Hull(): ConvexPolyhedron {
  const h = 1.35 * (1 - Math.cos(Math.PI / 5)) / (1 + Math.cos(Math.PI / 5));
  const vertices = [new Vec3(0, 1.35, 0), new Vec3(0, -1.35, 0)];
  for (let index = 0; index < 10; index += 1) {
    vertices.push(new Vec3(
      1.1 * Math.cos(index * Math.PI / 5),
      index % 2 === 0 ? h : -h,
      -1.1 * Math.sin(index * Math.PI / 5),
    ));
  }

  const faces: number[][] = [];
  for (let index = 0; index < 10; index += 1) {
    const ringIndex = index < 5 ? index * 2 : (index - 5) * 2 + 1;
    const face = [
      index < 5 ? 0 : 1,
      2 + ringIndex,
      2 + (ringIndex + 1) % 10,
      2 + (ringIndex + 2) % 10,
    ];
    const a = vertices[face[0]];
    const b = vertices[face[1]];
    const c = vertices[face[2]];
    if (b.vsub(a).cross(c.vsub(a)).dot(a) < 0) face.reverse();
    faces.push(face);
  }

  return new ConvexPolyhedron({ vertices, faces });
}

/** Read only a clearly upward face after the rigid body has settled. */
export function readTopFace(q: Quaternion): number | null {
  const ranked = Array.from({ length: 10 }, (_, digit) => ({
    digit,
    dot: d10FaceBasis(digit).normal.applyQuaternion(q).z,
  })).sort((a, b) => b.dot - a.dot);
  return ranked[0].dot > 0.98 && ranked[0].dot - ranked[1].dot > 0.05 ? ranked[0].digit : null;
}

export interface ThrowPose {
  position: [number, number, number];
  rotation: [number, number, number, number];
}
export type D10Trajectory = ThrowPose[][];

// BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
export const D6_VALUES = [1, 6, 2, 5, 3, 4] as const;

export function d6Normal(value: number): Vector3 {
  const normals = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0],
    [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ] as const;
  const normal = normals[D6_VALUES.indexOf(value as (typeof D6_VALUES)[number])];
  if (!normal) throw new Error('D6 value must be 1–6');
  return new Vector3(...normal);
}

export function d6Landing(value: number): Quaternion {
  return new Quaternion().setFromUnitVectors(d6Normal(value), new Vector3(0, 0, 1));
}

export function readD6Top(q: Quaternion): number | null {
  return D6_VALUES.find((value) => d6Normal(value).applyQuaternion(q).z > 0.98) ?? null;
}

/**
 * Produce a bounded visual trajectory for the already-authoritative digits.
 * The seeded PRNG affects motion only; it cannot change, reroll, or persist a
 * result. The default seed is deterministic and selected by die count so
 * ordinary D10 pairs and single D10s stay inside the bounded tray.
 */
export async function simulateD10Throw(
  digits: number[],
  seed: number | undefined = undefined,
  cancelled = () => false,
  faces: 6 | 10 = 10,
): Promise<D10Trajectory> {
  const valid = faces === 6
    ? digits.length >= 1 && digits.length <= 2 && digits.every((value) => Number.isInteger(value) && value >= 1 && value <= 6)
    : digits.length >= 1 && digits.length <= 2 && digits.every((value) => Number.isInteger(value) && value >= 0 && value <= 9);
  if (!valid) throw new Error(`Invalid D${faces} trajectory digits`);

  const readTop = faces === 6 ? readD6Top : readTopFace;
  const landing = faces === 6 ? d6Landing : d10Landing;
  const defaultSeed = faces === 10 && digits.length === 1 ? 4 : 1;
  let state = (seed ?? defaultSeed) >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const world = new World({ gravity: new Vec3(0, 0, -24), allowSleep: true });
  world.defaultContactMaterial.friction = 0.5;
  world.defaultContactMaterial.restitution = 0.25;

  const wall = (position: Vec3, axis?: Vec3, angle = 0) => {
    const body = new Body({ mass: 0, shape: new Plane(), position });
    if (axis) body.quaternion.setFromAxisAngle(axis, angle);
    world.addBody(body);
  };
  wall(new Vec3(0, 0, 0));
  for (const [x, y, hx, hy] of [[-4.65, 0, 0.15, 2.5], [4.65, 0, 0.15, 2.5], [0, -2.35, 4.8, 0.15], [0, 2.35, 4.8, 0.15]]) {
    world.addBody(new Body({
      mass: 0,
      shape: new Box(new Vec3(hx, hy, 0.65)),
      position: new Vec3(x, y, 0.65),
    }));
  }

  const bodies = digits.map((_, index) => {
    const direction = index === 0 ? 1 : -1;
    const body = new Body({
      mass: 1,
      shape: faces === 6 ? new Box(new Vec3(0.8, 0.8, 0.8)) : d10Hull(),
      position: new Vec3(direction * -6.2, index === 0 ? -0.65 : 0.65, 3.5 + index * 0.2),
      linearDamping: 0.08,
      angularDamping: 0.1,
      allowSleep: true,
      sleepSpeedLimit: 0.18,
      sleepTimeLimit: 0.35,
    });
    body.quaternion.setFromEuler(random() * 6, random() * 6, random() * 6);
    body.velocity.set(direction * (9 + random() * 2), direction * (0.3 + random() * 0.5), 1.5);
    body.angularVelocity.set(8 + random() * 8, direction * (14 + random() * 8), random() * 16 - 8);
    world.addBody(body);
    return body;
  });

  const frames: ThrowPose[][] = [];
  for (let step = 0; step < 1200; step += 1) {
    if (cancelled()) throw new Error('Throw cancelled');
    world.step(1 / 120);
    if (step % 2 === 0) {
      frames.push(bodies.map((body) => ({
        position: [body.position.x, body.position.y, body.position.z],
        rotation: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
      })));
    }
    if (step > 60 && bodies.every((body) => body.sleepState === Body.SLEEPING)) break;
    if (step % 120 === 119) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (!bodies.every((body) => body.sleepState === Body.SLEEPING)) throw new Error('Dice did not settle on the tray');
  if (bodies.some((body) => Math.abs(body.position.x) > 4.5 || Math.abs(body.position.y) > 2.2)) throw new Error('Dice did not land inside the tray');

  const corrections = bodies.map((body, index) => {
    const rotation = new Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    const actual = readTop(rotation);
    if (actual === null) throw new Error('Dice landed on an edge');
    return landing(actual).invert().multiply(landing(digits[index]));
  });
  for (const frame of frames) {
    frame.forEach((pose, index) => {
      pose.rotation = new Quaternion(...pose.rotation).multiply(corrections[index]).toArray() as ThrowPose['rotation'];
    });
  }

  // Keep two-die tens/units ordering visually stable without changing faces.
  if (digits.length === 2 && frames.at(-1)![0].position[0] > frames.at(-1)![1].position[0]) {
    const halfTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    for (const frame of frames) {
      for (const pose of frame) {
        pose.position[0] *= -1;
        pose.position[1] *= -1;
        pose.rotation = halfTurn.clone().multiply(new Quaternion(...pose.rotation)).toArray() as ThrowPose['rotation'];
      }
    }
  }

  const final = frames.at(-1);
  if (!final || !final.every((pose, index) => readTop(new Quaternion(...pose.rotation)) === digits[index])) {
    throw new Error('Physical landing does not match the verdict');
  }
  return frames;
}
