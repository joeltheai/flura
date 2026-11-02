(() => {
  "use strict";
  const { OrbitControls } = THREE;

  // One ring of petals, using the rounded outline from synth/garden.js.
  // Width scales uniformly to fit a spoke, preserving the silhouette as the
  // flower closes or the petal count increases.
  function createPetalGeometry({ count, open, length, curl }) {
    const rows = 32;
    const columns = 10;
    const halfSector = (Math.PI / count) * 0.92;
    const angle = -1.39 + open * 1.49;
    const rootRadius = 0.1 + open * 0.17;
    const radialSpan = length * Math.cos(angle);
    const rise = -length * Math.sin(angle);
    const cup = length * curl * 0.46 * Math.cos(angle);
    const profile = [];
    let widestSlope = 0;
    for (let row = 0; row <= rows; row++) {
      const u = row / rows * Math.PI;
      const t = (1 - Math.cos(u)) / 2;
      const radius = rootRadius + radialSpan * t;
      // Same radial/lateral parametrization as the synth's drawBloom().
      const width = Math.sin(u) * Math.sin(u / 2) * length * 0.46;
      widestSlope = Math.max(widestSlope, width / radius);
      profile.push({ t, radius, width });
    }
    const widthScale = Math.min(1, Math.tan(halfSector) / widestSlope);
    const positions = [];
    const indices = [];

    for (let side = 0; side < 2; side++) {
      for (const { t, radius, width } of profile) {
        for (let column = 0; column <= columns; column++) {
          const across = (column / columns) * 2 - 1;
          const x = width * widthScale * across;
          const edgeCup = length * 0.035 * across ** 2 * Math.sin(Math.PI * t);
          const thickness = length * 0.006 * Math.sin(Math.PI * t);
          const y = -0.025 + rise * t + cup * t * t + edgeCup
            + (side === 0 ? thickness : -thickness);
          positions.push(x, y, radius);
        }
      }
    }

    const stride = columns + 1;
    const surfaceCount = (rows + 1) * stride;
    for (let side = 0; side < 2; side++) {
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const a = side * surfaceCount + row * stride + column;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          if (side === 0) indices.push(a, c, b, b, c, d);
          else indices.push(a, b, c, b, d, c);
        }
      }
    }
    for (let row = 0; row < rows; row++) {
      for (const column of [0, columns]) {
        const a = row * stride + column;
        const b = a + stride;
        if (column === 0)
          indices.push(
            a,
            a + surfaceCount,
            b,
            b,
            a + surfaceCount,
            b + surfaceCount,
          );
        else
          indices.push(
            a,
            b,
            a + surfaceCount,
            b,
            b + surfaceCount,
            a + surfaceCount,
          );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }


  const DEFAULTS = Object.freeze({
    bloom: 78,
    petals: 9,
    petalLength: 1.35,
    curl: 35,
    height: 3.5,
    bend: 24,
    leafLength: 1.35,
    leafCount: 3,
    sway: 30,
    spin: 10,
  });
  const sections = [
    {
      title: "Bloom",
      controls: [
        ["bloom", "Bloom", 0, 100, 1, "%"],
        ["petals", "Petals", 5, 16, 1, ""],
        ["petalLength", "Length", 0.65, 1.9, 0.01, "×", "Petal length"],
        ["curl", "Curl", 0, 100, 1, "%", "Petal curl"],
      ],
    },
    {
      title: "Stem & leaves",
      controls: [
        ["height", "Height", 2, 4.7, 0.01, "×", "Stem height"],
        ["bend", "Bend", -65, 65, 1, "%", "Stem bend"],
        ["leafLength", "Leaf", 0.3, 2, 0.01, "×", "Leaf length"],
        ["leafCount", "Leaves", 0, 6, 1, ""],
      ],
    },
    {
      title: "Motion",
      controls: [
        ["sway", "Sway", 0, 100, 1, "%"],
        ["spin", "Spin", 0, 100, 1, "%", "Slow spin"],
      ],
    },
  ];
  const palette = {
    name: "Monochrome",
    petals: ["#c8c8c8", "#dddddd", "#b8b8b8"],
    center: "#999999",
    seed: "#333333",
    leaf: "#888888",
    stem: "#aaaaaa",
  };

  const state = { ...DEFAULTS };
  const current = { ...DEFAULTS };
  const inputs = new Map();
  const outputs = new Map();
  const sliderContainer = document.querySelector("#slider-controls");
  const announcement = document.querySelector("#announcement");

  function publishState() {
    window.dispatchEvent(new CustomEvent("flura:flower", { detail: { ...state } }));
  }

  function syncControl(key, value) {
    const input = inputs.get(key);
    input.value = value;
    const progress =
      (value - Number(input.min)) / (Number(input.max) - Number(input.min));
    input.style.setProperty("--fill", `${progress * 100}%`);
    const unit = input.dataset.unit;
    outputs.get(key).value =
      `${unit === "×" ? Number(value).toFixed(2) : Math.round(value)}${unit}`;
    publishState();
  }

  sections.forEach((section) => {
    const group = document.createElement("section");
    group.className = "control-section";
    group.setAttribute("aria-label", section.title);
    section.controls.forEach(
      ([key, label, min, max, step, unit, full = label]) => {
        const row = document.createElement("div");
        row.className = "control";
        row.innerHTML = `<label for="${key}">${label}</label><output for="${key}"></output><input type="range" id="${key}" min="${min}" max="${max}" step="${step}" data-unit="${unit}" aria-label="${full}" title="Double-click to reset" />`;
        const input = row.querySelector("input");
        inputs.set(key, input);
        outputs.set(key, row.querySelector("output"));
        input.addEventListener("input", () => {
          state[key] = Number(input.value);
          syncControl(key, state[key]);
        });
        input.addEventListener("dblclick", () => {
          state[key] = DEFAULTS[key];
          syncControl(key, state[key]);
        });
        syncControl(key, state[key]);
        group.append(row);
      },
    );
    sliderContainer.append(group);
  });

  let materials;

  document.querySelector("#reset").addEventListener("click", () => {
    Object.assign(state, DEFAULTS);
    for (const key of Object.keys(state)) syncControl(key, state[key]);
    announcement.textContent = "Flower reset.";
  });
  document.querySelector("#randomize").addEventListener("click", () => {
    const ranges = {
      bloom: [35, 100],
      petals: [6, 13],
      petalLength: [0.9, 1.65],
      curl: [10, 85],
      height: [2.5, 4.3],
      bend: [-50, 50],
      leafLength: [0.6, 1.8],
      leafCount: [1, 5],
      sway: [15, 65],
      spin: [0, 12],
    };
    for (const [key, min, max, step] of sections
      .flatMap((section) => section.controls)
      .map(([key, , min, max, step]) => [key, min, max, step])) {
      const [low, high] = ranges[key] ?? [min, max];
      state[key] = Number(
        (Math.round((low + Math.random() * (high - low)) / step) * step).toFixed(
          2,
        ),
      );
      syncControl(key, state[key]);
    }
    announcement.textContent = "Flower randomized.";
  });

  // Leaves and sepals have a softly ridged face, an underside, and an edge.
  function createLeafGeometry() {
    const rows = 14;
    const columns = 10;
    const positions = [];
    const indices = [];
    for (let side = 0; side < 2; side++) {
      for (let row = 0; row <= rows; row++) {
        const t = row / rows;
        const outline = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.95);
        const width = 0.25 * outline;
        for (let col = 0; col <= columns; col++) {
          const across = (col / columns) * 2 - 1;
          const x = across * width;
          const ridge = (1 - Math.abs(across)) * Math.sin(t * Math.PI) * 0.08;
          const cup = 0.12 * t * t;
          const y =
            ridge + cup + (side === 0 ? 0.009 : -0.009) * Math.sin(t * Math.PI);
          positions.push(x, y, t);
        }
      }
    }
    const stride = columns + 1;
    const surfaceCount = (rows + 1) * stride;
    for (let side = 0; side < 2; side++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const a = side * surfaceCount + row * stride + col;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          if (side === 0) indices.push(a, c, b, b, c, d);
          else indices.push(a, b, c, b, d, c);
        }
      }
    }
    for (let row = 0; row < rows; row++) {
      for (const col of [0, columns]) {
        const a = row * stride + col;
        const b = a + stride;
        if (col === 0)
          indices.push(
            a,
            a + surfaceCount,
            b,
            b,
            a + surfaceCount,
            b + surfaceCount,
          );
        else
          indices.push(
            a,
            b,
            a + surfaceCount,
            b,
            b + surfaceCount,
            a + surfaceCount,
          );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function startScene() {
    const canvas = document.querySelector("#flower-canvas");
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(4.4, 3.6, 7.6);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.15, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.enabled = false;
    const rotateButton = document.querySelector("#rotate-flower");
    rotateButton.addEventListener("click", () => {
      controls.enabled = !controls.enabled;
      canvas.classList.toggle("interactive", controls.enabled);
      rotateButton.setAttribute("aria-pressed", String(controls.enabled));
      rotateButton.setAttribute("aria-label", controls.enabled ? "Finish rotating flower" : "Rotate flower");
      rotateButton.title = controls.enabled ? "Finish rotating flower" : "Rotate flower";
      canvas.setAttribute("aria-label", controls.enabled ? "3D flower. Drag to rotate, pinch to zoom. Choose Done to swipe views." : "Floating 3D flower");
      announcement.textContent = controls.enabled ? "Drag the flower to rotate. Choose Done to swipe between views." : "Rotation off. Swipe to explore.";
    });
    controls.minDistance = 6;
    controls.maxDistance = 19;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI - 0.15;
    controls.saveState();
    document
      .querySelector("#reset-view")
      .addEventListener("click", () => controls.reset());
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(-3, 7, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(5, 1, -3);
    scene.add(fillLight);

    // A three-step lighting ramp gives flat blocks of color rather than glossy highlights.
    const gradient = new THREE.DataTexture(
      new Uint8Array([105, 190, 255]),
      3,
      1,
      THREE.RedFormat,
    );
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
    const material = (color) =>
      new THREE.MeshToonMaterial({
        color,
        gradientMap: gradient,
        side: THREE.DoubleSide,
      });
    materials = {
      petals: palette.petals.map(material),
      center: material(palette.center),
      seed: material(palette.seed),
      leaf: material(palette.leaf),
      stem: material(palette.stem),
    };
    const flower = new THREE.Group();
    scene.add(flower);
    const bloom = new THREE.Group();
    flower.add(bloom);
    const petalGroup = new THREE.Group();
    bloom.add(petalGroup);
    const leafGroup = new THREE.Group();
    flower.add(leafGroup);
    let petalGeometry = createPetalGeometry({
      count: state.petals,
      open: current.bloom / 100,
      length: current.petalLength,
      curl: current.curl / 100,
    });
    const leafGeometry = createLeafGeometry();
    const sepalGeometry = createLeafGeometry();
    const petals = [];
    const leaves = [];
    let previousPetalCount = -1;
    let previousLeafCount = -1;
    let previousPetalShape = "";
    let stem;
    let previousStem = "";

    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 32, 16),
      materials.center,
    );
    center.scale.set(1, 0.46, 1);
    center.position.y = 0.045;
    bloom.add(center);
    const calyx = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      materials.stem,
    );
    calyx.scale.set(1, 0.55, 1);
    calyx.position.y = -0.11;
    bloom.add(calyx);
    for (let i = 0; i < 5; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i * Math.PI * 2) / 5;
      const sepal = new THREE.Mesh(sepalGeometry, materials.leaf);
      sepal.scale.set(0.75, 0.8, 0.55);
      sepal.rotation.x = 0.3;
      pivot.position.y = -0.12;
      pivot.add(sepal);
      bloom.add(pivot);
    }
    // Deterministic golden-angle seed pattern; no random flicker when reshaping.
    const seeds = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.022, 7, 5),
      materials.seed,
      85,
    );
    const seedPose = new THREE.Object3D();
    for (let i = 0; i < 85; i++) {
      const radius = 0.285 * Math.sqrt((i + 0.5) / 85);
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      seedPose.position.set(
        Math.cos(angle) * radius,
        0.05 + 0.146 * Math.sqrt(1 - (radius / 0.32) ** 2),
        Math.sin(angle) * radius,
      );
      seedPose.scale.set(0.8, 1.2, 0.8);
      seedPose.updateMatrix();
      seeds.setMatrixAt(i, seedPose.matrix);
    }
    bloom.add(seeds);

    function rebuildPetals(count) {
      petalGroup.clear();
      petals.length = 0;
      for (let i = 0; i < count; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = i / count * Math.PI * 2;
        const petal = new THREE.Mesh(petalGeometry, materials.petals[i % 3]);
        pivot.add(petal);
        petalGroup.add(pivot);
        petals.push({ pivot, petal });
      }
    }

    function rebuildLeaves(count) {
      leafGroup.clear();
      leaves.length = 0;
      for (let i = 0; i < count; i++) {
        const pivot = new THREE.Group();
        const leaf = new THREE.Mesh(leafGeometry, materials.leaf);
        pivot.add(leaf);
        leafGroup.add(pivot);
        leaves.push({
          pivot,
          leaf,
          fraction: 0.22 + (i / Math.max(count, 1)) * 0.53,
        });
      }
    }
    const point = new THREE.Vector3();
    function reshape() {
      if (previousPetalCount !== state.petals) {
        previousPetalCount = state.petals;
        rebuildPetals(state.petals);
      }
      if (previousLeafCount !== state.leafCount) {
        previousLeafCount = state.leafCount;
        rebuildLeaves(state.leafCount);
      }
      const open = current.bloom / 100;
      const petalShape = [state.petals, open, current.petalLength, current.curl]
        .map((value) => value.toFixed(5))
        .join(",");
      if (previousPetalShape !== petalShape) {
        previousPetalShape = petalShape;
        const oldGeometry = petalGeometry;
        petalGeometry = createPetalGeometry({
          count: state.petals,
          open,
          length: current.petalLength,
          curl: current.curl / 100,
        });
        petals.forEach(({ petal }) => { petal.geometry = petalGeometry; });
        oldGeometry.dispose();
      }

      const centerWidth = 0.3 + open * 0.7;
      center.scale.set(centerWidth, 0.46, centerWidth);
      seeds.scale.set(centerWidth, 0.6 + open * 0.4, centerWidth);
      const bend = current.bend / 100;
      const height = current.height;
      const bottom = -1.95;
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(0, bottom, 0),
        new THREE.Vector3(-bend * 0.4, bottom + height * 0.35, 0.06),
        new THREE.Vector3(bend * 1.45, bottom + height * 0.72, -0.05),
        new THREE.Vector3(bend * 1.3, bottom + height, 0),
      );
      const stemKey = `${height.toFixed(4)},${bend.toFixed(4)}`;
      if (previousStem !== stemKey) {
        previousStem = stemKey;
        const geometry = new THREE.TubeGeometry(curve, 40, 0.042, 8, false);
        if (stem) {
          stem.geometry.dispose();
          stem.geometry = geometry;
        } else {
          stem = new THREE.Mesh(geometry, materials.stem);
          flower.add(stem);
        }
      }
      bloom.position.copy(curve.getPoint(1));
      bloom.rotation.set(0.5, 0.15, -0.12 - bend * 0.22);
      // Recenter the growing specimen without changing the user's orbit or zoom.
      const petalAngle = -1.39 + open * 1.49;
      const tipHeight =
        current.petalLength *
        (((Math.cos(petalAngle) * current.curl) / 100) * 0.46 -
          Math.sin(petalAngle));
      const top = bottom + height + Math.max(0.2, tipHeight) + 0.1;
      const centerY = (bottom + top) * 0.5;
      const targetShift = centerY - controls.target.y;
      camera.position.y += targetShift;
      controls.target.y = centerY;
      leaves.forEach(({ pivot, leaf, fraction }, i) => {
        pivot.position.copy(curve.getPoint(fraction, point));
        pivot.rotation.y = (i % 2 === 0 ? -1.2 : 1.8) + Math.floor(i / 2) * 0.62;
        leaf.rotation.x = -0.38 - i * 0.065;
        const length = current.leafLength * (1 - fraction * 0.25);
        leaf.scale.set(length * 1.3, length, length);
      });
    }

    const stage = document.querySelector(".stage");
    const resize = () => {
      const { width, height } = stage.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Keep the whole specimen in frame in portrait layouts, including long leaves.
      camera.fov = width / height < 0.85 ? 42 : 34;
      camera.updateProjectionMatrix();
    };
    let visible = false;
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(stage);
    new ResizeObserver(resize).observe(stage);
    resize();
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    let motion = !motionPreference.matches;
    let animationTime = 0;
    let spinAngle = -0.2;
    const motionButton = document.querySelector("#motion");
    function syncMotion() {
      motionButton.setAttribute("aria-pressed", String(motion));
      motionButton.setAttribute(
        "aria-label",
        motion ? "Pause floating motion" : "Resume floating motion",
      );
      motionButton.title = motion
        ? "Pause floating motion"
        : "Resume floating motion";
      document.querySelector("#motion-icon").innerHTML = motion
        ? '<path d="M7 5v10M13 5v10"/>'
        : '<path d="m7 4 8 6-8 6Z"/>';
    }
    motionButton.addEventListener("click", () => {
      motion = !motion;
      syncMotion();
    });
    motionPreference.addEventListener("change", (event) => {
      motion = !event.matches;
      syncMotion();
    });
    syncMotion();
    let lastTime = 0;
    function animate(time) {
      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      if (!visible || document.hidden) return;
      const blend = motionPreference.matches ? 1 : 1 - Math.exp(-delta * 12);
      for (const key of Object.keys(current)) {
        current[key] = THREE.MathUtils.lerp(current[key], state[key], blend);
        if (Math.abs(current[key] - state[key]) < 0.0001)
          current[key] = state[key];
      }
      reshape();
      if (motion) {
        animationTime += delta;
        spinAngle += ((delta * current.spin) / 100) * 0.35;
        const sway = current.sway / 100;
        flower.position.y = Math.sin(animationTime * 1.1) * 0.09 * sway;
        flower.rotation.z = Math.sin(animationTime * 0.75) * 0.065 * sway;
        flower.rotation.x = Math.sin(animationTime * 0.55 + 1) * 0.035 * sway;
        flower.rotation.y = spinAngle;
      }
      controls.update();
      renderer.render(scene, camera);
    }
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      showError("3D view lost. Reload the page.");
      renderer.setAnimationLoop(null);
    });
    renderer.setAnimationLoop(animate);
    // Expose a small read-only snapshot for diagnostics without exposing scene internals.
    window.flowerSnapshot = () => ({
      state: { ...state },
      palette: palette.name,
      petals: petals.length,
      leaves: leaves.length,
      motion,
      geometries: renderer.info.memory.geometries,
    });
  }

  function showError(message) {
    const error = document.querySelector("#scene-error");
    error.textContent = message;
    error.hidden = false;
  }

  try {
    startScene();
  } catch (error) {
    console.error(error);
    showError("This flower needs WebGL. Try a browser with hardware acceleration.");
  }
})();
