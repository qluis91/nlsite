/**
 * Pure Antigravity force helpers (no Three.js).
 * Cursor interaction is soft repulsion — never ring attraction.
 */

/**
 * Soft quadratic repulsion away from the cursor.
 * Direction is particle − cursor (never attraction / ring targeting).
 */
export function computeRepulsion(dx, dy, {
  repelRadius = 7.5,
  repelForce = 4.2,
  maxRepel = 3.6,
  maxZOffset = 1.8,
} = {}) {
  const distance = Math.hypot(dx, dy);
  if (distance >= repelRadius || distance <= 0.0001) {
    return { x: 0, y: 0, z: 0, strength: 0, distance };
  }
  const influence = 1 - distance / repelRadius;
  const strength = influence * influence;
  const inv = 1 / distance;
  let x = dx * inv * strength * repelForce;
  let y = dy * inv * strength * repelForce;
  let z = strength * maxZOffset * 0.55;
  const mag = Math.hypot(x, y);
  if (mag > maxRepel) {
    const clamp = maxRepel / mag;
    x *= clamp;
    y *= clamp;
  }
  if (z > maxZOffset) z = maxZOffset;
  return { x, y, z, strength, distance };
}

/** Final target = suspended home/drift + temporary repulsion offset. */
export function composeParticleTarget(homeX, homeY, homeZ, driftAngle, driftRadius, repel) {
  const suspendedX = homeX + Math.cos(driftAngle) * driftRadius;
  const suspendedY = homeY + Math.sin(driftAngle) * driftRadius * 0.6;
  return {
    suspendedX,
    suspendedY,
    suspendedZ: homeZ,
    targetX: suspendedX + (repel?.x || 0),
    targetY: suspendedY + (repel?.y || 0),
    targetZ: homeZ + (repel?.z || 0),
  };
}
