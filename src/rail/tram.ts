import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { clamp } from '../core/math';
import { CollisionGroup, type GameContext, type MaterialLibrary, type System } from '../core/types';
import { addRoadObstacle } from '../ai/obstacles';
import { mergeGeometries } from '../world/props';

/**
 * The heritage tram that works the city loop (the Christchurch Tramway opened in February 1995, so it is the
 * newest old thing in town). One car circulates on the tram line from the map: it keeps to walking-ish speeds,
 * crawls round the tight corners, stops every so often, and waits for anything on the track ahead rather than
 * pushing through it. It is solid: cars bounce off it and it does not move for them.
 */

const LENGTH = 9.4;
const WIDTH = 2.3;
const HEIGHT = 3.35;
/** Distance between the two bogie pivots; the body is carried on the chord between them. */
const BOGIES = 5.2;
const CRUISE = 6.5;
const CORNER = 2.8;
const ACCEL = 0.7;
const BRAKE = 1.7;
const STOP_EVERY = 240;
const DWELL = 9;
/** Beyond this distance from the player the tram is not drawn or collided with (it keeps its timetable). */
const ACTIVE_RANGE = 520;

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function buildTram(m: MaterialLibrary): THREE.Group {
  const group = new THREE.Group();
  const half = LENGTH / 2;
  const saloon = 5.6; // the enclosed middle; the rest is open platform at each end
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, shadow = true) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // Underframe, bogies and wheels: dark steel.
  const steel: THREE.BufferGeometry[] = [box(WIDTH - 0.5, 0.22, LENGTH - 0.2, 0, 0.5, 0), box(0.14, 0.3, 0.5, 0, 0.45, half + 0.15), box(0.14, 0.3, 0.5, 0, 0.45, -half - 0.15)];
  for (const z of [-BOGIES / 2, BOGIES / 2]) {
    steel.push(box(WIDTH - 0.9, 0.3, 1.9, 0, 0.36, z));
    for (const dz of [-0.6, 0.6]) {
      for (const x of [-0.72, 0.72]) steel.push(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 14).rotateZ(Math.PI / 2).translate(x, 0.33, z + dz));
    }
  }
  // Cow-catcher bars at each end.
  for (const s of [-1, 1]) steel.push(box(WIDTH - 0.3, 0.08, 0.08, 0, 0.3, s * (half + 0.05)), box(WIDTH - 0.3, 0.08, 0.08, 0, 0.18, s * (half + 0.1)));
  add(mergeGeometries(steel), m.get('metal', { color: 0x1c1d1f, roughness: 0.7 }));

  // Lower panels and end dashes: deep red.
  const red: THREE.BufferGeometry[] = [box(WIDTH, 0.95, saloon, 0, 1.08, 0)];
  for (const s of [-1, 1]) {
    red.push(box(WIDTH, 0.9, 0.08, 0, 1.06, s * (half - 0.04))); // dash
    red.push(box(WIDTH, 0.12, (LENGTH - saloon) / 2, 0, 0.66, s * (saloon / 2 + (LENGTH - saloon) / 4))); // platform floor edge
  }
  add(mergeGeometries(red), m.get('paintedMetal', { color: 0x7d1f1b, roughness: 0.45 }));

  // Window band, pillars, letterboard and roof edge: cream.
  const cream: THREE.BufferGeometry[] = [box(WIDTH, 0.16, saloon, 0, 1.63, 0), box(WIDTH + 0.06, 0.22, LENGTH, 0, 2.68, 0)];
  for (let i = 0; i <= 6; i++) {
    const z = -saloon / 2 + (saloon * i) / 6;
    for (const x of [-WIDTH / 2 + 0.04, WIDTH / 2 - 0.04]) cream.push(box(0.08, 0.95, 0.1, x, 2.13, z));
  }
  for (const s of [-1, 1]) {
    // Saloon bulkheads and the corner posts of the open platforms.
    cream.push(box(WIDTH, 1.1, 0.07, 0, 2.1, s * (saloon / 2)));
    for (const x of [-WIDTH / 2 + 0.05, WIDTH / 2 - 0.05]) cream.push(box(0.09, 1.2, 0.09, x, 2.08, s * (half - 0.06)));
  }
  add(mergeGeometries(cream), m.get('paintedMetal', { color: 0xe9dfc2, roughness: 0.5 }));

  // Roof with a clerestory, trolley pole and its base.
  const roof: THREE.BufferGeometry[] = [box(WIDTH + 0.16, 0.1, LENGTH + 0.3, 0, 2.84, 0), box(WIDTH - 0.9, 0.3, saloon + 0.6, 0, 3.02, 0), box(WIDTH - 0.7, 0.07, saloon + 0.9, 0, 3.2, 0)];
  roof.push(box(0.5, 0.12, 0.7, 0, 3.28, 0.4));
  roof.push(new THREE.CylinderGeometry(0.025, 0.025, 4.4, 6).rotateX(Math.PI / 2 - 0.42).translate(0, 4.15, -1.55));
  add(mergeGeometries(roof), m.get('paintedMetal', { color: 0x4c4f4d, roughness: 0.7 }));

  // Timber: platform floors, slatted seats along the saloon, window sills.
  const timber: THREE.BufferGeometry[] = [box(WIDTH - 0.1, 0.06, LENGTH - 0.1, 0, 0.64, 0)];
  for (const x of [-0.72, 0.72]) timber.push(box(0.5, 0.08, saloon - 0.5, x, 1.1, 0), box(0.07, 0.5, saloon - 0.5, x + Math.sign(x) * 0.26, 1.36, 0));
  add(mergeGeometries(timber), m.get('timber', { color: 0x7a5a3a }), false);

  // Glass along both sides and in the bulkheads.
  const glass: THREE.BufferGeometry[] = [];
  for (const x of [-WIDTH / 2 + 0.03, WIDTH / 2 - 0.03]) glass.push(box(0.02, 0.92, saloon - 0.1, x, 2.14, 0));
  for (const s of [-1, 1]) glass.push(box(WIDTH - 0.5, 0.8, 0.02, 0, 2.15, s * (half - 0.05)));
  add(mergeGeometries(glass), m.get('glass', { color: 0x9fb4b8, transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.2 }), false);

  // Headlamps (both ends) and saloon lamps: lit after dark.
  const lamps: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) lamps.push(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12).rotateX(Math.PI / 2).translate(0, 1.1, s * (half + 0.01)));
  for (let i = 0; i < 4; i++) lamps.push(box(0.12, 0.05, 0.12, 0, 2.76, -saloon / 2 + 0.7 + (i * (saloon - 1.4)) / 3));
  add(mergeGeometries(lamps), m.emitter(0xffe2ae, 'night'), false);

  // Destination boards at each end and route boards along the roof edge.
  const boardMaterial = m.sign('CATHEDRAL SQUARE', { bg: '#1b1b1b', fg: '#f3ead0', style: 'block', aspect: 6, border: false });
  for (const s of [-1, 1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.25), boardMaterial);
    board.position.set(0, 2.68, s * (half + 0.012));
    if (s < 0) board.rotation.y = Math.PI;
    group.add(board);
  }
  return group;
}

interface Sample {
  x: number;
  y: number;
  z: number;
  s: number;
}

export function createTram(ctx: GameContext): System & { readonly state?: unknown } {
  const line = ctx.world.railways.find((r) => r.kind === 'tram');
  if (!line || line.points.length < 8) return { name: 'tram' };

  // The loop as a closed polyline with running distance.
  const pts: Sample[] = [];
  let run = 0;
  for (let i = 0; i < line.points.length; i++) {
    const p = line.points[i];
    if (i > 0) run += Math.hypot(p.x - line.points[i - 1].x, p.z - line.points[i - 1].z);
    pts.push({ x: p.x, y: p.y, z: p.z, s: run });
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  const gap = Math.hypot(first.x - last.x, first.z - last.z);
  const loop = gap < 30;
  const total = run + (loop ? gap : 0);

  const at = (s: number, out: THREE.Vector3): THREE.Vector3 => {
    let d = loop ? ((s % total) + total) % total : clamp(s, 0, total);
    if (d >= run) {
      // The closing stretch from the last point back to the first.
      const t = gap > 1e-3 ? (d - run) / gap : 0;
      return out.set(last.x + (first.x - last.x) * t, last.y + (first.y - last.y) * t, last.z + (first.z - last.z) * t);
    }
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= d) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    d -= a.s;
    const t = b.s > a.s ? d / (b.s - a.s) : 0;
    return out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  };

  const group = buildTram(ctx.gfx.materials);
  ctx.scene.add(group);
  const R = ctx.physics.rapier;
  const body: RAPIER.RigidBody = ctx.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
  const collider = ctx.physics.world.createCollider(
    R.ColliderDesc.cuboid(WIDTH / 2, (HEIGHT - 0.3) / 2, LENGTH / 2)
      .setTranslation(0, 0.3 + (HEIGHT - 0.3) / 2, 0)
      .setFriction(0.4)
      .setCollisionGroups(ctx.physics.groups(CollisionGroup.World, CollisionGroup.Vehicle | CollisionGroup.Character | CollisionGroup.Debris)),
    body,
  );

  const front = new THREE.Vector3();
  const rear = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let s = 0;
  let speed = 0;
  let dwell = 4;
  let nextStop = STOP_EVERY;
  let heading = 0;
  let bellAt = -100;
  let time = 0;
  let active = true;

  /** Is anyone, or any vehicle, on the track within `reach` metres of the front of the tram? */
  const blocked = (reach: number): boolean => {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const cx = group.position.x;
    const cz = group.position.z;
    const inPath = (x: number, z: number, radius: number): boolean => {
      const dx = x - cx;
      const dz = z - cz;
      const along = dx * fx + dz * fz - LENGTH / 2;
      const side = Math.abs(dx * fz - dz * fx);
      return along > -0.5 && along < reach + radius && side < WIDTH / 2 + 0.35 + radius;
    };
    for (const a of ctx.actors.near(cx + fx * (LENGTH / 2 + reach / 2), cz + fz * (LENGTH / 2 + reach / 2), reach / 2 + 3)) {
      if (a.alive && !a.vehicle && inPath(a.position.x, a.position.z, 0.3)) {
        waitingFor = a.kind;
        return true;
      }
    }
    for (const v of ctx.vehicles.all) {
      if (Math.abs(v.position.x - cx) > 40 || Math.abs(v.position.z - cz) > 40) continue;
      if (inPath(v.position.x, v.position.z, v.spec.length * 0.45)) {
        waitingFor = v.spec.id;
        return true;
      }
    }
    waitingFor = '';
    return false;
  };

  const place = () => {
    at(s + BOGIES / 2, front);
    at(s - BOGIES / 2, rear);
    heading = Math.atan2(front.x - rear.x, front.z - rear.z);
    group.position.set((front.x + rear.x) / 2, (front.y + rear.y) / 2 + 0.04, (front.z + rear.z) / 2);
    group.rotation.y = heading;
  };
  place();

  // What the traffic's autopilots see: a long slow vehicle with somebody at the controls.
  const seenByTraffic = {
    position: group.position,
    velocity: new THREE.Vector3(),
    heading: 0,
    destroyed: false,
    burning: false,
    controller: 'traffic' as const,
    spec: { width: WIDTH, length: LENGTH },
    driver: {},
  };
  addRoadObstacle(seenByTraffic);

  let waitingFor = '';

  return {
    name: 'tram',
    /** For the dev console: where the tram is and what it is doing. */
    get state() {
      return { s: Math.round(s), of: Math.round(total), speed: +speed.toFixed(2), dwell: +Math.max(0, dwell).toFixed(1), nextStop: Math.round(nextStop), waitingFor, x: Math.round(group.position.x), z: Math.round(group.position.z) };
    },
    fixedUpdate(dt: number) {
      time += dt;
      const pp = ctx.player.position;
      const near = Math.abs(pp.x - group.position.x) < ACTIVE_RANGE && Math.abs(pp.z - group.position.z) < ACTIVE_RANGE;
      if (near !== active) {
        active = near;
        group.visible = near;
        collider.setEnabled(near);
      }

      // How fast the track ahead allows: slow for corners, stop for whatever is in the way.
      at(s + BOGIES / 2 + 7, ahead);
      const bend = Math.abs(Math.atan2(Math.sin(Math.atan2(ahead.x - front.x, ahead.z - front.z) - heading), Math.cos(Math.atan2(ahead.x - front.x, ahead.z - front.z) - heading)));
      let want = bend > 0.12 ? CORNER : CRUISE;
      const stopping = (speed * speed) / (2 * BRAKE);
      if (dwell > 0) {
        dwell -= dt;
        want = 0;
      } else if (s + stopping >= nextStop) {
        want = 0;
        if (speed < 0.05) {
          dwell = DWELL;
          nextStop += STOP_EVERY;
        }
      }
      if (near && blocked(stopping + 3.5)) {
        want = 0;
        // A clang of the gong at whoever is standing on the track.
        if (time - bellAt > 3.5 && pp.distanceToSquared(group.position) < 60 * 60) {
          bellAt = time;
          ctx.audio.play('tramBell', { at: group.position, volume: 0.8 });
        }
      }
      if (speed < want) speed = Math.min(want, speed + ACCEL * dt);
      else speed = Math.max(want, speed - BRAKE * dt);
      // Pulling away from a stop: one ring.
      if (near && dwell <= 0 && speed > 0.05 && speed < 0.05 + ACCEL * dt * 1.5 && time - bellAt > 3.5 && pp.distanceToSquared(group.position) < 80 * 80) {
        bellAt = time;
        ctx.audio.play('tramBell', { at: group.position, volume: 0.6 });
      }
      s += speed * dt;
      if (loop && s > total) {
        s -= total;
        nextStop -= total;
      } else if (!loop && s >= total - BOGIES) {
        s = BOGIES; // a line that is not a loop: start again from the far end
        nextStop = STOP_EVERY;
      }
      place();
      seenByTraffic.heading = heading;
      seenByTraffic.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
      if (near) {
        q.setFromAxisAngle(up, heading);
        body.setNextKinematicTranslation({ x: group.position.x, y: group.position.y, z: group.position.z });
        body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }
    },
  };
}
