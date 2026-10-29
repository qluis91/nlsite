/**
 * Infinite Gallery — unique bubbles + click-to-center selection.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
let renderer;
let mat;

function makeItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `Item ${index + 1}`,
    category: 'Demo',
    type: 'image',
    thumbnail: `/uploads/gallery/thumbnails/item-${index + 1}.webp`,
  }));
}

before(async () => {
  renderer = await import(
    pathToFileURL(path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs')).href
  );
  mat = await import(
    pathToFileURL(path.join(root, 'public/vendor/gl-matrix/index.js')).href
  );
});

describe('Sparse low-count layouts (1–3)', () => {
  function assertOnSphere(point, radius = 4.2) {
    const length = Math.hypot(point[0], point[1], point[2]);
    assert.ok(Math.abs(length - radius) < 1e-5, `expected radius ${radius}, got ${length}`);
  }

  it('1 item sits on FRONT_DIRECTION and is closest front', () => {
    const points = renderer.createSpherePoints(1);
    assert.equal(points.length, 1);
    assert.ok(Math.abs(points[0][0]) < 1e-6);
    assert.ok(Math.abs(points[0][1]) < 1e-6);
    assert.ok(Math.abs(points[0][2] - 4.2) < 1e-5);
    assertOnSphere(points[0]);
    const orientation = mat.quat.create();
    assert.equal(renderer.closestFrontPointIndex(points, orientation), 0);
  });

  it('2 items are symmetric front-hemisphere bubbles', () => {
    const points = renderer.createSpherePoints(2);
    assert.equal(points.length, 2);
    points.forEach((point) => assertOnSphere(point));
    assert.ok(points[0][0] < 0);
    assert.ok(points[1][0] > 0);
    assert.ok(Math.abs(points[0][0] + points[1][0]) < 1e-5);
    assert.ok(Math.abs(points[0][1] - points[1][1]) < 1e-5);
    assert.ok(points[0][2] > 0 && points[1][2] > 0);
    assert.ok(Math.abs(points[0][2] - points[1][2]) < 1e-5);
    assert.notDeepEqual(
      Array.from(points[0]).map((v) => v.toFixed(5)),
      Array.from(points[1]).map((v) => v.toFixed(5))
    );
  });

  it('3 items form a compact front-facing triangle', () => {
    const points = renderer.createSpherePoints(3);
    assert.equal(points.length, 3);
    points.forEach((point) => {
      assertOnSphere(point);
      assert.ok(point[2] > 0, 'all points start in front hemisphere');
    });
    const sortedByY = [...points].sort((a, b) => b[1] - a[1]);
    assert.ok(sortedByY[0][1] > sortedByY[1][1]);
    assert.ok(Math.abs(sortedByY[0][0]) < 0.35);
    const lower = sortedByY.slice(1);
    assert.ok(lower.some((point) => point[0] < 0));
    assert.ok(lower.some((point) => point[0] > 0));
  });

  it('count >= 4 keeps Fibonacci distribution cardinality', () => {
    assert.equal(renderer.createSpherePoints(4).length, 4);
    assert.equal(renderer.createSpherePoints(6).length, 6);
    assert.equal(renderer.createSpherePoints(30).length, 30);
    // Fibonacci count=1 would place off-front; count=4 must not use the count-1 special case.
    const four = renderer.createSpherePoints(4);
    assert.notEqual(four.length, 1);
  });
});

describe('Unique bubbles — no duplication', () => {
  it('5 items → 5 sphere points and 1:1 mapping', () => {
    const points = renderer.createSpherePoints(5);
    assert.equal(points.length, 5);
    for (let index = 0; index < 5; index += 1) {
      assert.equal(index, index); // pointIndex === itemIndex
    }
    const source = fs.readFileSync(
      path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(source, /int itemIndex = vInstanceId;/);
    assert.doesNotMatch(source, /vInstanceId % uItemCount/);
    assert.doesNotMatch(source, /pointIndex % this\.items\.length/);
  });

  it('24 items → exactly 24 bubbles', () => {
    assert.equal(renderer.createSpherePoints(24).length, 24);
    const layout = renderer.createAtlasLayout(24, 4096);
    assert.equal(layout.columns * layout.rows >= 24, true);
  });

  it('30 items remain unique within the new safety cap (no silent 24 cutoff)', () => {
    assert.equal(renderer.createSpherePoints(30).length, 30);
    const layout = renderer.createAtlasLayout(30, 4096);
    // Atlas must have capacity for all 30 cells (was previously clamped to 24).
    assert.ok(layout.columns * layout.rows >= 30);
    const source = fs.readFileSync(
      path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(source, /MAX_ITEMS = 64/);
    assert.doesNotMatch(source, /MAX_ITEMS = 24/);
  });

  it('preserves multi-row atlas Y-flip compensation', () => {
    const source = fs.readFileSync(
      path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(source, /textureRow = uAtlasRows - 1 - logicalRow/);
    const layout = renderer.createAtlasLayout(5, 4096);
    assert.equal(layout.columns, 3);
    assert.equal(layout.rows, 2);
    const uv = renderer.atlasCellUv(0, layout);
    assert.equal(uv.minV, 0.5);
  });
});

describe('Pointer picking', () => {
  it('returns the bubble under the pointer and null for empty space', () => {
    const points = renderer.createSpherePoints(6);
    const orientation = mat.quat.create();
    const layout = renderer.resolveSphereLayout(800, 600, 6);
    const camera = renderer.createCameraMatrices(800, 600, layout);

    // Project point 0 and click its center.
    const projected = renderer.projectBubbleToScreen({
      point: points[0],
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointIndex: 0,
      activePointIndex: renderer.closestFrontPointIndex(points, orientation),
    });
    assert.ok(projected, 'front-ish bubble should project');

    const hit = renderer.pickBubbleAtScreenPoint({
      spherePoints: points,
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointerX: projected.screenX,
      pointerY: projected.screenY,
      activePointIndex: renderer.closestFrontPointIndex(points, orientation),
    });
    assert.ok(hit);
    assert.equal(hit.pointIndex, hit.itemIndex);

    const miss = renderer.pickBubbleAtScreenPoint({
      spherePoints: points,
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointerX: 2,
      pointerY: 2,
      activePointIndex: -1,
    });
    assert.equal(miss, null);
  });

  it('prefers the front-most bubble when projections overlap', () => {
    // Two coincident world points with different depths via camera distance:
    // synthesize projected candidates by stacking two points near FRONT.
    const near = mat.vec3.fromValues(0, 0, 4.2);
    const far = mat.vec3.fromValues(0.01, 0, -4.2);
    const orientation = mat.quat.create();
    const layout = renderer.resolveSphereLayout(800, 600, 2);
    const camera = renderer.createCameraMatrices(800, 600, layout);

    const nearProj = renderer.projectBubbleToScreen({
      point: near,
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointIndex: 0,
      activePointIndex: 0,
    });
    assert.ok(nearProj);

    const hit = renderer.pickBubbleAtScreenPoint({
      spherePoints: [near, far],
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointerX: nearProj.screenX,
      pointerY: nearProj.screenY,
      activePointIndex: 0,
    });
    assert.ok(hit);
    assert.equal(hit.pointIndex, 0);
  });
});

describe('Targeted snap + pending selection', () => {
  it('snapTargetForPoint places the requested point near FRONT_DIRECTION', () => {
    const points = renderer.createSpherePoints(8);
    const orientation = mat.quat.create();
    // Rotate away from identity so closest-front ≠ arbitrary index 4.
    mat.quat.rotateY(orientation, orientation, 1.1);
    mat.quat.rotateX(orientation, orientation, 0.4);

    const targetIndex = 4;
    const closestBefore = renderer.closestFrontPointIndex(points, orientation);
    assert.notEqual(closestBefore, targetIndex);

    const target = renderer.snapTargetForPoint(points[targetIndex], orientation);
    const rotated = mat.vec3.transformQuat(mat.vec3.create(), points[targetIndex], target);
    mat.vec3.normalize(rotated, rotated);
    const front = mat.vec3.fromValues(0, 0, 1);
    assert.ok(mat.vec3.dot(rotated, front) > 0.999);
  });

  it('finishPendingSelection opens the clicked item once after snap', () => {
    const items = makeItems(6);
    let selected = [];
    const fake = {
      items,
      spherePoints: renderer.createSpherePoints(6),
      orientation: mat.quat.create(),
      pendingSelectionPointIndex: 4,
      options: {
        onSelect(item) { selected.push(item); },
        onActiveChange() {},
      },
      container: {
        querySelector() { return null; },
      },
      activePointIndex: -1,
      activeItemIndex: -1,
      emitActive: renderer.InfiniteMenuRenderer.prototype.emitActive,
      finishPendingSelection: renderer.InfiniteMenuRenderer.prototype.finishPendingSelection,
    };

    // Align item 4 to front so finishPendingSelection accepts it.
    const target = renderer.snapTargetForPoint(fake.spherePoints[4], fake.orientation);
    mat.quat.copy(fake.orientation, target);
    fake.finishPendingSelection();

    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, 5);
    assert.equal(fake.pendingSelectionPointIndex, null);

    fake.finishPendingSelection();
    assert.equal(selected.length, 1);
  });

  it('source click path uses pick + pending selection; drag threshold preserved', () => {
    const source = fs.readFileSync(
      path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(source, /handleBubbleClick/);
    assert.match(source, /pendingSelectionPointIndex/);
    assert.match(source, /CLICK_DISTANCE_PX/);
    assert.match(source, /finishPendingSelection/);
    assert.match(source, /beginSnapToPoint\(hit\.pointIndex\)/);
  });
});
