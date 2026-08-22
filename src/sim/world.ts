import * as CANNON from 'cannon-es';
import { PHYSICS } from '../config';

export function createPhysicsWorld(): CANNON.World {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYSICS.gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.05;
  world.solver.iterations = 10;
  world.solver.tolerance = 0.001;

  const chassisMat = new CANNON.Material('chassis');
  const worldMat = new CANNON.Material('worldStatic');
  world.addContactMaterial(
    new CANNON.ContactMaterial(chassisMat, worldMat, { friction: 0.25, restitution: 0.08 })
  );
  (world as unknown as { ironslideMaterials?: { chassisMat: CANNON.Material; worldMat: CANNON.Material } }).ironslideMaterials =
    { chassisMat, worldMat };
  return world;
}

export function worldMaterials(world: CANNON.World): { chassisMat: CANNON.Material; worldMat: CANNON.Material } {
  const m = (world as unknown as { ironslideMaterials? }).ironslideMaterials;
  if (!m) throw new Error('world not created via createPhysicsWorld');
  return m;
}
