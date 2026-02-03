import * as THREE from 'three';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0015); // Dark purple background
scene.fog = new THREE.Fog(0x3b2a6d, 150, 1200); // Purple fog for atmospheric depth

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    5000 // Increased far plane for larger map
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('container').appendChild(renderer.domElement);

// Map data
let mapData = null;
let mapCenter = { x: 0, z: 0 };

// Traffic light system
const TRAFFIC_LIGHT_TIMINGS = {
    STRAIGHT_GREEN: 10,  // seconds
    LEFT_GREEN: 5,       // seconds for left-turn phase
    YELLOW: 2,           // seconds
    RED: 0               // derived from cycle
};

let trafficLights = []; // Array of {intersection, lights: [{mesh, phase, timer, approach, type}], group, signalState}
const INTERSECTION_THRESHOLD = 3.0; // meters - coordinates within this distance are considered the same point

// Road type to width mapping (must match renderRoads)
const ROAD_TYPE_WIDTHS = {
    'motorway': 12,
    'trunk': 10,
    'primary': 8,
    'secondary': 7,
    'tertiary': 6,
    'residential': 5,
    'unclassified': 5,
    'service': 4,
    'living_street': 5
};

// Vehicle state (bicycle model)
const vehicle = {
    x: 0,
    z: 0,
    angle: 0, // theta (radians)
    velocity: 0, // v (m/s)
    steering: 0, // delta (radians) - steering angle (target)
    steeringActual: 0, // actual steering with smoothing
    wheelbase: 2.5, // L (meters) - distance between front and rear axles
    maxSteeringAngle: Math.PI / 4.5, // ~40 degrees max steering for better turning
    maxSpeed: 25, // m/s (~56 mph)
    acceleration: 0,
    angularVelocity: 0,
    tilt: 0, // for visual tilt on curves
    tiltTarget: 0 // target tilt for smooth interpolation
};

// Autopilot state - UPDATED VALUES
const autopilot = {
    enabled: false,
    waypoints: [], // Array of {x, z} in simulator coordinates
    currentWaypointIndex: 0,
    waypointThreshold: 12.0, // Distance (meters) to consider waypoint reached (increased to prevent missing)
    
    // Lookahead parameters (Pure Pursuit)
    lookaheadGain: 0.8,        // Multiplier for speed-based lookahead
    minLookahead: 4.0,         // Minimum lookahead distance (m)
    maxLookahead: 18.0,        // Maximum lookahead distance (m)
    
    // Steering parameters
    steeringSmoothingFactor: 0.15,  // How fast steering changes (0-1, higher = faster)
    steeringGain: 1.8,              // Heading error multiplier
    
    // Speed parameters
    targetSpeedStraight: 20.0,  // Max speed on straight roads (m/s)
    minTurnSpeed: 8.0,          // Min speed for sharp turns (m/s)
    speedResponseRate: 0.15,    // How quickly speed adjusts (0-1) (slightly faster)
    
    // Curvature detection
    curvatureLookahead: 6,      // How many waypoints ahead to check for turns
    maxCurvature: 0.25,         // Curvature threshold for max slowdown (rad/m)
    
    // Steering oscillation damping
    steeringHistory: [],            // Track recent steering commands [{t, s}]
    oscillationWindowSec: 4.0,      // seconds of history to analyze
    oscillationThreshold: 3,        // sign flips within window => oscillating
    oscillationMinAvgDelta: 0.02,   // ignore tiny jitter; require some magnitude
    oscillationDeadzone: 0.01,      // rad: smaller deadzone => more sensitive flip counting
    dampingFactor: 1.0,             // Dynamic gain multiplier
    dampingTarget: 0.25,            // Clamp gain down to this when oscillating
    dampingRecoveryRate: 2.5,       // Per-second recovery back to 1.0 (time-based)
    dampingSmoothingBoost: 0.22,    // extra steering smoothing when damping is active
    _lastDampingUpdateSec: null,    // internal timestamp (seconds)
    oscActive: false,              // debug: true when oscillation detected this frame
    oscDirectionChanges: 0,         // debug: sign flips in current window
    oscAvgAbsDelta: 0,              // debug: avg |Δsteer| in current window
    
    // Internal state
    prevSteering: 0,            // For smoothing
    currentSpeed: 0,            // Smoothed target speed
    lastWaypointDistance: Infinity, // Track distance to waypoint to detect passing

    // Traffic light compliance - UPDATED VALUES
    drivingState: 'NORMAL',     // NORMAL | APPROACHING_LIGHT | STOPPING | STOPPED | PROCEEDING
    activeLight: null,         // { stopPoint, signal, distance, approachDir, intersectionPos } or null
    yellowDecision: null,      // null | 'STOP' | 'GO' (locked once set for current yellow)
    minStoppingDistance: 20.0,  // m - REDUCED: below this at yellow => commit to GO
    brakingDistance: 50.0,     // m - INCREASED: start gradual decel when red and within this
    stopOffset: 6.0,           // m - INCREASED: stop further from intersection
    forwardSearchRadius: 100.0,  // m - INCREASED: look further ahead for lights
    alignmentThreshold: 0.8,    // INCREASED: stricter alignment requirement (cos ~37°)
    stoppedAtIntersection: null, // when STOPPED at red: { intersectionPos, approachDir } so we don't drive off after overshoot

    // Traffic Light Scoring Weights - REBALANCED
    scoringWeights: {
        proximity: 80,         // REDUCED: Closest light preferred but not dominant
        headingAlignment: 120, // INCREASED: Vehicle heading aligned with approach direction
        directlyAhead: 80,     // INCREASED: Stop point in front of vehicle
        pathMatching: 100,     // DOUBLED: Waypoint direction matches light's approach direction
        approachSide: 60,      // INCREASED: Vehicle on the correct side of intersection
        lightFacing: 20        // REDUCED: Light faces vehicle (less important)
    },

    // Debug settings for traffic light scoring
    debugScoring: false,       // Enable detailed score breakdown logging
    debugScoringVisuals: false // Enable visual debug indicators
};

// Debug visuals for autopilot
let routeLine = null;
let waypointMarker = null;
let waypointMarkerGroup = null;

// Traffic light compliance debug visuals
let stopPointMarker = null;
let activeLightHighlight = null;
let trafficLightDebugGroup = null;
let scoringVisualsGroup = null; // For traffic light scoring debug visuals

// Sky system
let skyMesh, skyMaterial;
let starfield = null;
let nebulaClouds = [];
let glowSpots = [];

// Ground plane (will be resized when map loads)
let ground = null;
let gridHelper = null;

function createGround(size = 2000) {
    // Remove old ground if exists
    if (ground) scene.remove(ground);
    if (gridHelper) scene.remove(gridHelper);
    
    const groundGeometry = new THREE.PlaneGeometry(size, size);
    
    // PBR material for realistic grass/earth terrain
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: new THREE.Color(0x5f7354), // Muted grass/earth green
        roughness: 1.0,                    // Fully matte (natural terrain)
        metalness: 0.0,                    // Non-metallic
        fog: true,                         // Fades into fog naturally
        side: THREE.DoubleSide
    });
    
    // Add subtle color variation to break flatness
    groundMaterial.color.offsetHSL(
        0,                              // No hue shift
        0,                              // No saturation shift
        (Math.random() - 0.5) * 0.03    // Slight lightness variation
    );
    
    // Slight darkening so roads visually pop on top
    groundMaterial.color.multiplyScalar(0.95);
    
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;  // Receives shadows from buildings/vehicles
    ground.castShadow = false;    // Doesn't cast shadows
    scene.add(ground);

    // Grid helper (optional - can be removed for cleaner look)
    gridHelper = new THREE.GridHelper(size, size / 50, 0x444444, 0x222222);
    scene.add(gridHelper);
}

// =========================
// 🌌 Procedural Nebula Sky
// =========================
function createProceduralSky() {
    const skyGeometry = new THREE.SphereGeometry(5000, 48, 48);

    skyMaterial = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
            uTime: { value: 0 },
            uTopColor: { value: new THREE.Color(0x4a0d7a) },   // deeper purple
            uBottomColor: { value: new THREE.Color(0x2d1b69) } // deep purple-blue horizon
        },
        vertexShader: `
            varying vec3 vWorldPos;
            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uTopColor;
            uniform vec3 uBottomColor;
            varying vec3 vWorldPos;

            // cheap hash noise
            float hash(vec3 p) {
                return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
            }

            float noise(vec3 p) {
                vec3 i = floor(p);
                vec3 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);

                return mix(
                    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
                    f.z
                );
            }

            void main() {
                vec3 dir = normalize(vWorldPos);

                // vertical gradient with smoother blending
                float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
                float gradientFactor = pow(h, 0.8); // Smoother transition
                vec3 color = mix(uBottomColor, uTopColor, gradientFactor);

                // nebula clouds with better blending
                float n1 = noise(dir * 6.0 + uTime * 0.02);
                float n2 = noise(dir * 12.0 - uTime * 0.04);
                float n3 = noise(dir * 3.0 + uTime * 0.01);
                float nebula = smoothstep(0.4, 0.75, n1 * 0.5 + n2 * 0.3 + n3 * 0.2);

                // Deeper purple nebula tint
                vec3 nebulaColor = vec3(0.4, 0.15, 0.6) * nebula * 0.5;
                color = mix(color, color + nebulaColor, nebula * 0.7);

                // More stars with varying brightness
                float stars1 = step(0.996, noise(dir * 120.0));
                float stars2 = step(0.998, noise(dir * 200.0));
                float stars3 = step(0.994, noise(dir * 80.0));
                color += vec3(stars1 * 0.8 + stars2 * 1.0 + stars3 * 0.6);

                gl_FragColor = vec4(color, 1.0);
            }
        `
    });

    skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(skyMesh);
}

// Call once
createProceduralSky();

// Create additional starfield for more stars
function createStarfield() {
    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 3000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 10000;
        positions[i + 1] = (Math.random() - 0.5) * 10000;
        positions[i + 2] = (Math.random() - 0.5) * 10000;

        // Purple-tinted stars with varying brightness
        const brightness = Math.random();
        colors[i] = 0.7 + brightness * 0.3;     // R
        colors[i + 1] = 0.5 + brightness * 0.3; // G
        colors[i + 2] = 0.9 + brightness * 0.1; // B
    }

    starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starsMaterial = new THREE.PointsMaterial({
        size: 0.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        sizeAttenuation: false
    });

    starfield = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starfield);
}

// Create nebula clouds using planes with gradient textures
function createNebulaCloud(color1, color2, scale, position) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Create radial gradient
    const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(0.5, color2);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    // Add some noise for texture
    for (let i = 0; i < 3000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 3;
        const alpha = Math.random() * 0.3;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(x, y, size, size);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const geometry = new THREE.PlaneGeometry(scale, scale);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.x = Math.random() * Math.PI;
    mesh.rotation.y = Math.random() * Math.PI;
    
    return mesh;
}

// Create enhanced sky elements
function createEnhancedSkyElements() {
    // Create starfield
    createStarfield();

    // Add multiple nebula clouds with purple/pink/blue colors (scaled for larger world)
    const nebulaPositions = [
        { x: -1000, y: 500, z: -2000 },
        { x: 1500, y: -800, z: -2500 },
        { x: -500, y: -1000, z: -1800 },
        { x: 800, y: 1200, z: -2200 },
        { x: -1500, y: -500, z: -2800 }
    ];
    
    nebulaClouds = [
        createNebulaCloud('rgba(138,43,226,0.4)', 'rgba(75,0,130,0.2)', 2500, nebulaPositions[0]),
        createNebulaCloud('rgba(218,112,214,0.3)', 'rgba(138,43,226,0.15)', 3000, nebulaPositions[1]),
        createNebulaCloud('rgba(147,112,219,0.35)', 'rgba(106,90,205,0.2)', 2800, nebulaPositions[2]),
        createNebulaCloud('rgba(186,85,211,0.3)', 'rgba(138,43,226,0.15)', 2200, nebulaPositions[3]),
        createNebulaCloud('rgba(75,0,130,0.4)', 'rgba(72,61,139,0.2)', 2600, nebulaPositions[4])
    ];

    nebulaClouds.forEach((cloud, i) => {
        cloud.userData.relativePos = new THREE.Vector3(
            nebulaPositions[i].x,
            nebulaPositions[i].y,
            nebulaPositions[i].z
        );
        scene.add(cloud);
    });

    // Add some brighter glow spots for ethereal effect
    for (let i = 0; i < 8; i++) {
        const glowGeometry = new THREE.SphereGeometry(50, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.75 + Math.random() * 0.08, 0.8, 0.6),
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        // Store relative position to camera
        glow.userData.relativePos = new THREE.Vector3(
            (Math.random() - 0.5) * 4000,
            (Math.random() - 0.5) * 4000,
            -1500 - Math.random() * 1500
        );
        scene.add(glow);
        glowSpots.push(glow);
    }
}

// Initialize enhanced sky elements
createEnhancedSkyElements();

// Create initial ground
createGround(2000);

// Vehicle mesh (simple box car)
const carGroup = new THREE.Group();

// Car body
const carBodyGeometry = new THREE.BoxGeometry(2, 0.6, 4);
const carBodyMaterial = new THREE.MeshPhongMaterial({ color: 0xff4444 });
const carBody = new THREE.Mesh(carBodyGeometry, carBodyMaterial);
carBody.position.y = 0.5;
carBody.castShadow = true;
carGroup.add(carBody);

// Car roof
const roofGeometry = new THREE.BoxGeometry(1.8, 0.5, 2);
const roofMaterial = new THREE.MeshPhongMaterial({ color: 0xcc0000 });
const roof = new THREE.Mesh(roofGeometry, roofMaterial);
roof.position.set(0, 1.1, -0.3);
roof.castShadow = true;
carGroup.add(roof);

// Wheels
const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
const wheelMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });

const wheels = [];
for (let i = 0; i < 4; i++) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    const x = i % 2 === 0 ? -0.8 : 0.8;
    const z = i < 2 ? 0.8 : -0.8;
    wheel.position.set(x, 0.3, z);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    carGroup.add(wheel);
    wheels.push(wheel);
}

carGroup.position.set(vehicle.x, 0, vehicle.z);
scene.add(carGroup);

// Lighting
const sunLight = new THREE.DirectionalLight(0xffd6ff, 1.2);
sunLight.position.set(-300, 800, -200);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 2000;
sunLight.shadow.bias = -0.0001; // Reduce shadow acne
sunLight.shadow.normalBias = 0.02; // Additional bias for smoother shadows
scene.add(sunLight);

// Ambient fill (increased to reduce harsh shadows on buildings)
scene.add(new THREE.AmbientLight(0x665588, 0.65));

// Add subtle fill light from opposite side to reduce shadow darkness
const fillLight = new THREE.DirectionalLight(0xffd6ff, 0.3);
fillLight.position.set(300, 400, 200); // Opposite side, lower intensity
fillLight.castShadow = false; // Fill lights don't need shadows
scene.add(fillLight);

// Camera position (follow vehicle)
const cameraOffset = new THREE.Vector3(0, 8, 10); // Behind and above vehicle
camera.position.copy(carGroup.position).add(cameraOffset);
camera.lookAt(carGroup.position);

// Store initial positions for reset
const initialCarPosition = { x: 0, z: 0, angle: 0 };
const initialCameraPosition = camera.position.clone();
const initialCameraLookAt = carGroup.position.clone();

// Spawn position (set when teleporting, used for reset) 
let spawnPosition = null;
let spawnMarker = null;

// Admin camera mode state
const adminCamera = {
    enabled: false,
    position: camera.position.clone(),
    lookAt: new THREE.Vector3(0, 0, 0),
    speed: 20, // meters per second
    fastSpeed: 60, // fast speed with shift
    topDownMode: false
};

// Input handling
const keys = {
    w: false,
    s: false,
    a: false,
    d: false,
    space: false,
    // Admin camera controls
    arrowUp: false,
    arrowDown: false,
    arrowLeft: false,
    arrowRight: false,
    q: false, // Up (Y+)
    e: false, // Down (Y-)
    shift: false,
    tab: false
};

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const code = e.code;
    
    // WASD for car (only if admin mode is off)
    if (!adminCamera.enabled && (key === 'w' || key === 's' || key === 'a' || key === 'd')) {
        keys[key] = true;
        e.preventDefault();
    }
    
    // Spacebar for reset (always active)
    if (key === ' ') {
        keys.space = true;
        e.preventDefault();
        // Reset immediately on spacebar press
        resetCarAndCamera();
    }
    
    // Tab to toggle admin camera mode
    if (key === 'tab') {
        keys.tab = true;
        e.preventDefault();
        toggleAdminCamera();
    }
    
    // Shift for fast movement
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
        keys.shift = true;
    }
    
    // Admin camera controls (only when admin mode is enabled)
    if (adminCamera.enabled) {
        if (code === 'ArrowUp' || code === 'KeyW') {
            keys.arrowUp = true;
            e.preventDefault();
        }
        if (code === 'ArrowDown' || code === 'KeyS') {
            keys.arrowDown = true;
            e.preventDefault();
        }
        if (code === 'ArrowLeft' || code === 'KeyA') {
            keys.arrowLeft = true;
            e.preventDefault();
        }
        if (code === 'ArrowRight' || code === 'KeyD') {
            keys.arrowRight = true;
            e.preventDefault();
        }
        if (key === 'q') {
            keys.q = true; // Move up (Y+)
            e.preventDefault();
        }
        if (key === 'e') {
            keys.e = true; // Move down (Y-)
            e.preventDefault();
        }
        // T for top-down view toggle
        if (key === 't') {
            e.preventDefault();
            toggleTopDownView();
        }
    }

    // L to toggle traffic light scoring visuals (when autopilot is enabled)
    if (key === 'l' && autopilot.enabled) {
        e.preventDefault();
        autopilot.debugScoringVisuals = !autopilot.debugScoringVisuals;
        const checkbox = document.getElementById('debugScoringVisuals');
        if (checkbox) checkbox.checked = autopilot.debugScoringVisuals;
        console.log(`Traffic light scoring visuals: ${autopilot.debugScoringVisuals ? 'ON' : 'OFF'}`);
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    const code = e.code;
    
    // WASD for car
    if (key === 'w' || key === 's' || key === 'a' || key === 'd') {
        keys[key] = false;
    }
    if (key === ' ') {
        keys.space = false;
    }
    if (key === 'tab') {
        keys.tab = false;
    }
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
        keys.shift = false;
    }
    
    // Admin camera controls
    if (code === 'ArrowUp' || code === 'KeyW') {
        keys.arrowUp = false;
    }
    if (code === 'ArrowDown' || code === 'KeyS') {
        keys.arrowDown = false;
    }
    if (code === 'ArrowLeft' || code === 'KeyA') {
        keys.arrowLeft = false;
    }
    if (code === 'ArrowRight' || code === 'KeyD') {
        keys.arrowRight = false;
    }
    if (key === 'q') {
        keys.q = false;
    }
    if (key === 'e') {
        keys.e = false;
    }
});

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Physics constants
const ACCELERATION_RATE = 15.0; // m/s²
const BRAKE_RATE = 20.0; // m/s²
const STEERING_RATE = 4.0; // rad/s - how fast steering changes
const STEERING_SMOOTH = 8.0; // Reduced because autopilot handles own smoothing
const FRICTION = 0.98; // velocity decay when no input (higher = less friction)
const MIN_SPEED_FOR_TURN = 0.3; // minimum speed to allow turning
const MAX_ANGULAR_VELOCITY = 1.2; // rad/s - maximum rotation speed (prevents instant 360s)
const MIN_TURNING_RADIUS = 4.0; // meters - minimum realistic turning radius
const TURN_SPEED_REDUCTION = 0.4; // how much speed is reduced during turns (0-1, higher = more reduction)
const BASE_MAX_SPEED = 25.0; // m/s (~56 mph) - base max speed

// Validate and sanitize vehicle state (prevent NaN/Infinity bugs)
function validateVehicleState() {
    // Validate position
    if (!isFinite(vehicle.x) || !isFinite(vehicle.z)) {
        console.warn('Invalid vehicle position detected, resetting to (0, 0)');
        vehicle.x = 0;
        vehicle.z = 0;
    }
    
    // Clamp position to reasonable bounds (prevent car from flying thousands of meters away)
    // Assuming map is roughly within ±5000 meters from center
    const MAX_POSITION = 10000; // 10km max distance from origin
    if (Math.abs(vehicle.x) > MAX_POSITION || Math.abs(vehicle.z) > MAX_POSITION) {
        console.warn(`Vehicle position out of bounds: (${vehicle.x.toFixed(2)}, ${vehicle.z.toFixed(2)}), resetting to (0, 0)`);
        vehicle.x = 0;
        vehicle.z = 0;
        vehicle.velocity = 0; // Stop the vehicle if it's way out of bounds
    }
    
    // Validate angle (normalize to [-PI, PI])
    if (!isFinite(vehicle.angle)) {
        console.warn('Invalid vehicle angle detected, resetting to 0');
        vehicle.angle = 0;
    } else {
        // Normalize angle to [-PI, PI] range
        while (vehicle.angle > Math.PI) vehicle.angle -= 2 * Math.PI;
        while (vehicle.angle < -Math.PI) vehicle.angle += 2 * Math.PI;
    }
    
    // Validate velocity
    if (!isFinite(vehicle.velocity)) {
        console.warn('Invalid vehicle velocity detected, resetting to 0');
        vehicle.velocity = 0;
    } else {
        // Clamp velocity to reasonable bounds
        vehicle.velocity = Math.max(-BASE_MAX_SPEED * 2, Math.min(BASE_MAX_SPEED * 2, vehicle.velocity));
    }
    
    // Validate steering
    if (!isFinite(vehicle.steering)) {
        vehicle.steering = 0;
    } else {
        vehicle.steering = Math.max(-vehicle.maxSteeringAngle, Math.min(vehicle.maxSteeringAngle, vehicle.steering));
    }
    
    if (!isFinite(vehicle.steeringActual)) {
        vehicle.steeringActual = 0;
    } else {
        vehicle.steeringActual = Math.max(-vehicle.maxSteeringAngle, Math.min(vehicle.maxSteeringAngle, vehicle.steeringActual));
    }
    
    // Validate angular velocity
    if (!isFinite(vehicle.angularVelocity)) {
        vehicle.angularVelocity = 0;
    } else {
        vehicle.angularVelocity = Math.max(-MAX_ANGULAR_VELOCITY * 2, Math.min(MAX_ANGULAR_VELOCITY * 2, vehicle.angularVelocity));
    }
}

// Bicycle model physics
function updatePhysics(deltaTime) {
    // Validate deltaTime (prevent huge jumps from tab inactivity or invalid values)
    if (!isFinite(deltaTime) || deltaTime <= 0 || deltaTime > 0.1) {
        console.warn(`Invalid deltaTime: ${deltaTime}, clamping to 0.016`);
        deltaTime = 0.016; // ~60 FPS
    }
    
    // Validate vehicle state before physics update
    validateVehicleState();
    
    // Manual controls only if autopilot is disabled
    if (!autopilot.enabled) {
        // Steering input (target steering) - only if admin mode is off
        if (!adminCamera.enabled && keys.a) {
            vehicle.steering = Math.max(vehicle.steering - STEERING_RATE * deltaTime, -vehicle.maxSteeringAngle);
        } else if (!adminCamera.enabled && keys.d) {
            vehicle.steering = Math.min(vehicle.steering + STEERING_RATE * deltaTime, vehicle.maxSteeringAngle);
        } else {
            // Return steering to center smoothly
            vehicle.steering = THREE.MathUtils.lerp(vehicle.steering, 0, STEERING_RATE * deltaTime * 2);
        }

        // Smooth steering interpolation (wheels turn gradually, not instantly)
        vehicle.steeringActual = THREE.MathUtils.lerp(
            vehicle.steeringActual,
            vehicle.steering,
            STEERING_SMOOTH * deltaTime
        );

        // Throttle/Brake input - only if admin mode is off
        if (!adminCamera.enabled && keys.w) {
            vehicle.acceleration = ACCELERATION_RATE;
        } else if (!adminCamera.enabled && keys.s) {
            vehicle.acceleration = -BRAKE_RATE;
        } else {
            vehicle.acceleration = 0;
            // Apply friction when no input
            vehicle.velocity *= FRICTION;
            if (Math.abs(vehicle.velocity) < 0.05) {
                vehicle.velocity = 0;
            }
        }
    } else {
        // Autopilot mode: steering and throttle are controlled by updateAutopilot
        // Smooth steering interpolation (wheels turn gradually, not instantly)
        vehicle.steeringActual = THREE.MathUtils.lerp(
            vehicle.steeringActual,
            vehicle.steering,
            STEERING_SMOOTH * deltaTime
        );
        
        // Apply friction when no acceleration input
        if (vehicle.acceleration === 0) {
            vehicle.velocity *= FRICTION;
            if (Math.abs(vehicle.velocity) < 0.05) {
                vehicle.velocity = 0;
            }
        }
    }

    // Update velocity (with validation)
    const velocityDelta = vehicle.acceleration * deltaTime;
    if (isFinite(velocityDelta)) {
        vehicle.velocity += velocityDelta;
    }
    
    // Speed reduction during turns (realistic: can't maintain max speed while turning sharply)
    // More steering = more speed reduction
    const steeringFactor = Math.abs(vehicle.steeringActual) / vehicle.maxSteeringAngle; // 0 to 1
    const speedReductionFactor = 1.0 - (steeringFactor * TURN_SPEED_REDUCTION); // 1.0 to 0.6
    const effectiveMaxSpeed = BASE_MAX_SPEED * speedReductionFactor;
    
    // Clamp velocity with turn-based max speed (with validation)
    if (isFinite(vehicle.velocity)) {
        vehicle.velocity = Math.max(-effectiveMaxSpeed * 0.5, Math.min(effectiveMaxSpeed, vehicle.velocity));
    } else {
        vehicle.velocity = 0;
    }

    // Only allow turning when moving (more realistic - cars can't turn in place)
    const effectiveSteering = Math.abs(vehicle.velocity) > MIN_SPEED_FOR_TURN 
        ? vehicle.steeringActual 
        : 0;

    // Bicycle model equations - use actual smoothed steering
    // θ += (v / L) * tan(δ) * dt
    // Only turn if moving
    if (Math.abs(vehicle.velocity) > MIN_SPEED_FOR_TURN && isFinite(vehicle.velocity) && isFinite(effectiveSteering)) {
        // Calculate angular velocity from bicycle model (with validation)
        if (vehicle.wheelbase > 0.001) { // Prevent division by zero
            let angularVel = (vehicle.velocity / vehicle.wheelbase) * Math.tan(effectiveSteering);
            
            // Validate angular velocity calculation
            if (!isFinite(angularVel)) {
                angularVel = 0;
            }
            
            // Limit angular velocity to prevent instant 360s and unrealistic turning
            // This enforces a minimum turning radius based on speed
            const maxAngularVel = Math.abs(vehicle.velocity) / MIN_TURNING_RADIUS;
            if (isFinite(maxAngularVel)) {
                angularVel = Math.max(-Math.min(MAX_ANGULAR_VELOCITY, maxAngularVel), 
                                     Math.min(MAX_ANGULAR_VELOCITY, maxAngularVel, angularVel));
            }
            
            vehicle.angularVelocity = angularVel;
            
            // Update angle with validation
            const angleDelta = vehicle.angularVelocity * deltaTime;
            if (isFinite(angleDelta)) {
                vehicle.angle += angleDelta;
            }
        } else {
            vehicle.angularVelocity = 0;
        }
    } else {
        // No turning when stationary or moving too slowly
        vehicle.angularVelocity = 0;
    }

    // In three.js: X is left/right, Z is forward/backward
    // For angle=0, we want to move forward (negative Z direction)
    // x += v * sin(θ) * dt (horizontal movement)
    // z -= v * cos(θ) * dt (forward movement, negative because +Z goes into screen)
    // Validate all values before position update
    if (isFinite(vehicle.velocity) && isFinite(vehicle.angle) && isFinite(deltaTime)) {
        const sinAngle = Math.sin(vehicle.angle);
        const cosAngle = Math.cos(vehicle.angle);
        
        if (isFinite(sinAngle) && isFinite(cosAngle)) {
            const dx = vehicle.velocity * sinAngle * deltaTime;
            const dz = vehicle.velocity * cosAngle * deltaTime;
            
            if (isFinite(dx) && isFinite(dz)) {
                vehicle.x += dx;
                vehicle.z -= dz;
            }
        }
    }
    
    // Final validation after position update
    validateVehicleState();

    // Calculate tilt target based on angular velocity and speed (SlowRoads.io style)
    // More tilt when turning fast at high speed
    const speedFactor = Math.min(Math.abs(vehicle.velocity) / vehicle.maxSpeed, 1.0);
    const turnFactor = Math.min(Math.abs(vehicle.angularVelocity) * 2.0, 1.0);
    vehicle.tiltTarget = vehicle.angularVelocity * 0.15 * speedFactor * turnFactor;
    vehicle.tiltTarget = Math.max(-0.2, Math.min(0.2, vehicle.tiltTarget)); // Clamp to reasonable range

    // Note: Reset is now handled separately via resetCarAndCamera() function
}

// SlowRoads.io-style visual effects
function updateVehicleVisuals() {
    // Update car position and rotation
    carGroup.position.x = vehicle.x;
    carGroup.position.z = vehicle.z;
    carGroup.rotation.y = -vehicle.angle; // Negative because three.js rotates around Y axis

    // Smooth tilt interpolation (prevents 90 degree jumps)
    vehicle.tilt = THREE.MathUtils.lerp(vehicle.tilt, vehicle.tiltTarget, 0.15);
    // Apply tilt with smoothing - only tilt if moving
    if (Math.abs(vehicle.velocity) > 0.1) {
        carGroup.rotation.z = vehicle.tilt;
    } else {
        carGroup.rotation.z = THREE.MathUtils.lerp(carGroup.rotation.z, 0, 0.2);
    }

    // Rotate wheels based on velocity (smooth rotation)
    const wheelRotationSpeed = vehicle.velocity * 0.8; // Faster rotation for visual effect
    wheels.forEach((wheel, index) => {
        // Rotate wheels around X axis when moving
        if (Math.abs(vehicle.velocity) > 0.01) {
            wheel.rotation.x += wheelRotationSpeed * 0.01;
        }
        
        // Front wheels (first 2) turn smoothly with actual steering
        if (index < 2) {
            // Smooth wheel turning - wheels turn before car body rotates
            const currentWheelAngle = wheel.rotation.y;
            wheel.rotation.y = THREE.MathUtils.lerp(currentWheelAngle, vehicle.steeringActual, 0.2);
        } else {
            // Rear wheels stay straight
            wheel.rotation.y = 0;
        }
    });

    // Subtle suspension effect (slight bounce based on speed)
    const targetY = 0.5 + Math.abs(vehicle.velocity) * 0.008;
    carBody.position.y = THREE.MathUtils.lerp(carBody.position.y, targetY, 0.1);
    
    // Slight body roll when turning (subtle)
    const bodyRoll = vehicle.steeringActual * 0.15;
    carBody.rotation.z = THREE.MathUtils.lerp(carBody.rotation.z, bodyRoll, 0.1);
}

// Admin camera controls
function updateAdminCamera(deltaTime) {
    const speed = keys.shift ? adminCamera.fastSpeed : adminCamera.speed;
    const moveSpeed = speed * deltaTime;
    
    // Get camera's forward and right vectors in world space
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    
    // If in top-down mode, use XZ plane movement (panning) and Q/E for zoom (Y movement)
    if (adminCamera.topDownMode) {
        // Forward/backward (Arrow Up/Down or W/S) - move along Z axis (north/south)
        if (keys.arrowUp || keys.arrowDown) {
            const direction = keys.arrowUp ? -1 : 1;
            adminCamera.position.z += direction * moveSpeed;
        }
        // Left/right (Arrow Left/Right or A/D) - move along X axis (east/west)
        if (keys.arrowLeft || keys.arrowRight) {
            const direction = keys.arrowLeft ? -1 : 1;
            adminCamera.position.x += direction * moveSpeed;
        }
        // Up/down (Q/E) - zoom in/out by changing Y (altitude)
        if (keys.q || keys.e) {
            const direction = keys.q ? 1 : -1;
            adminCamera.position.y = Math.max(10, Math.min(500, adminCamera.position.y + direction * moveSpeed));
        }
        
        // Update camera position and ensure it looks straight down
        camera.position.copy(adminCamera.position);
        adminCamera.lookAt.set(adminCamera.position.x, 0, adminCamera.position.z);
        camera.lookAt(adminCamera.lookAt);
        return; // Skip normal 3D movement logic
    } else {
        // Normal 3D movement using camera-relative directions
        // Forward/backward (Arrow Up/Down or W/S)
        if (keys.arrowUp || keys.arrowDown) {
            const direction = keys.arrowUp ? 1 : -1;
            adminCamera.position.addScaledVector(forward, direction * moveSpeed);
        }
        // Left/right (Arrow Left/Right or A/D)
        if (keys.arrowLeft || keys.arrowRight) {
            const direction = keys.arrowLeft ? -1 : 1;
            adminCamera.position.addScaledVector(right, direction * moveSpeed);
        }
        // Up/down (Q/E)
        if (keys.q || keys.e) {
            const direction = keys.q ? 1 : -1;
            adminCamera.position.addScaledVector(up, direction * moveSpeed);
        }
    }
    
    // Update camera position directly
    camera.position.copy(adminCamera.position);
    
    // Update look-at point (for top-down, look straight down; otherwise look forward)
    if (adminCamera.topDownMode) {
        adminCamera.lookAt.set(adminCamera.position.x, 0, adminCamera.position.z);
        camera.lookAt(adminCamera.lookAt);
    } else {
        // Look in the direction the camera is facing (or at a point ahead)
        const lookTarget = adminCamera.position.clone().addScaledVector(forward, 10);
        adminCamera.lookAt.copy(lookTarget);
        camera.lookAt(adminCamera.lookAt);
    }
}

// Toggle admin camera mode
function toggleAdminCamera() {
    adminCamera.enabled = !adminCamera.enabled;
    
    if (adminCamera.enabled) {
        // Enter admin mode: save current camera position
        adminCamera.position.copy(camera.position);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        adminCamera.lookAt.copy(camera.position).addScaledVector(forward, 10);
        
        // Show admin mode indicator
        updateAdminStatus('Admin Camera Mode: ON (Tab to toggle, T for top-down, Space to reset)');
    } else {
        // Exit admin mode: camera will resume following vehicle
        updateAdminStatus('');
    }
}

// Toggle top-down view
function toggleTopDownView() {
    if (!adminCamera.enabled) return;
    
    adminCamera.topDownMode = !adminCamera.topDownMode;
    
    if (adminCamera.topDownMode) {
        // Switch to top-down: position camera above current XZ position
        const currentX = adminCamera.position.x;
        const currentZ = adminCamera.position.z;
        adminCamera.position.set(currentX, 150, currentZ); // 150 meters up for good view
        adminCamera.lookAt.set(currentX, 0, currentZ); // Look straight down at ground
        camera.position.copy(adminCamera.position);
        camera.lookAt(adminCamera.lookAt);
        camera.rotation.x = -Math.PI / 2; // Ensure camera is looking straight down
        updateAdminStatus('Top-Down View: ON (Arrows/WASD to pan, Q/E to zoom, T to exit)');
    } else {
        // Exit top-down: maintain XZ position but adjust Y for normal 3D view
        const currentX = adminCamera.position.x;
        const currentZ = adminCamera.position.z;
        adminCamera.position.set(currentX, 50, currentZ); // Reasonable height for 3D view
        // Look at a point ahead
        adminCamera.lookAt.set(currentX, 0, currentZ - 20); // Look forward
        camera.position.copy(adminCamera.position);
        camera.lookAt(adminCamera.lookAt);
        updateAdminStatus('Top-Down View: OFF (Normal 3D view, T to toggle)');
    }
}

// Reset car and camera to initial positions
function resetCarAndCamera() {
    // Use spawn position if available (from teleport), otherwise use initial position
    const resetPos = spawnPosition || initialCarPosition;
    
    // Reset vehicle state
    vehicle.x = resetPos.x;
    vehicle.z = resetPos.z;
    vehicle.angle = resetPos.angle || 0;
    vehicle.velocity = 0;
    vehicle.steering = 0;
    vehicle.steeringActual = 0;
    vehicle.angularVelocity = 0;
    vehicle.tilt = 0;
    vehicle.tiltTarget = 0;
    
    // Reset camera
    if (adminCamera.enabled) {
        // If in admin mode, reset admin camera position too
        if (spawnPosition) {
            // Position camera behind car at spawn location
            const spawnCameraOffset = new THREE.Vector3(0, 8, 10);
            adminCamera.position.set(
                spawnPosition.x + spawnCameraOffset.x,
                spawnPosition.y + spawnCameraOffset.y,
                spawnPosition.z + spawnCameraOffset.z
            );
            adminCamera.lookAt.set(spawnPosition.x, 0, spawnPosition.z);
        } else {
            adminCamera.position.copy(initialCameraPosition);
            adminCamera.lookAt.copy(initialCameraLookAt);
        }
        adminCamera.topDownMode = false;
        camera.position.copy(adminCamera.position);
        camera.lookAt(adminCamera.lookAt);
    } else {
        // Normal mode: reset to follow position behind spawn/initial location
        if (spawnPosition) {
            const spawnCameraOffset = new THREE.Vector3(0, 8, 10);
            camera.position.set(
                spawnPosition.x + spawnCameraOffset.x,
                spawnPosition.y + spawnCameraOffset.y,
                spawnPosition.z + spawnCameraOffset.z
            );
            camera.lookAt(spawnPosition.x, 0, spawnPosition.z);
        } else {
            camera.position.copy(initialCameraPosition);
            camera.lookAt(initialCameraLookAt);
        }
    }
    
    // Update car visual position
    carGroup.position.set(vehicle.x, 0, vehicle.z);
    carGroup.rotation.y = -vehicle.angle;
    carGroup.rotation.z = 0;
    
    updateAdminStatus(adminCamera.enabled ? 'Admin Camera Mode: ON (Tab to toggle, T for top-down)' : '');
}

// Create spawn marker visualization (green sphere)
function createSpawnMarker(x, y, z) {
    // Remove existing marker if present
    if (spawnMarker) {
        scene.remove(spawnMarker);
        spawnMarker = null;
    }
    
    // Create green marker sphere
    const markerGeometry = new THREE.SphereGeometry(2, 16, 16);
    const markerMaterial = new THREE.MeshPhongMaterial({ 
        color: 0x00ff00,
        emissive: 0x00ff00,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.8
    });
    spawnMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    spawnMarker.position.set(x, y + 1, z);
    
    // Add pulsing animation helper
    spawnMarker.userData.originalScale = 1.0;
    spawnMarker.userData.pulseSpeed = 0.02;
    
    scene.add(spawnMarker);
}

// Teleport car to a real-world location
async function teleportCar(address = null, lat = null, lon = null, yaw = 0) {
    const statusEl = document.getElementById('teleportStatus');
    if (statusEl) {
        statusEl.textContent = 'Teleporting...';
        statusEl.style.color = '#ffaa00';
    }
    
    try {
        // Build request payload
        const payload = {};
        if (address) {
            payload.address = address;
        } else if (lat !== null && lon !== null) {
            payload.lat = parseFloat(lat);
            payload.lon = parseFloat(lon);
        } else {
            throw new Error('Either address or lat/lon must be provided');
        }
        if (yaw !== null && yaw !== undefined) {
            payload.yaw = parseFloat(yaw);
        }
        
        // Call teleport API
        const response = await fetch('/api/teleport', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Teleportation failed');
        }
        
        if (!data.success) {
            throw new Error('Teleportation failed: ' + (data.error || 'Unknown error'));
        }
        
        // Update vehicle position (with validation)
        const pos = data.position;
        if (!pos || !isFinite(pos.x) || !isFinite(pos.z)) {
            throw new Error('Invalid position received from server');
        }
        if (!isFinite(data.yaw_rad)) {
            console.warn('Invalid yaw_rad, using 0');
            data.yaw_rad = 0;
        }
        
        vehicle.x = pos.x;
        vehicle.z = pos.z;
        vehicle.angle = -data.yaw_rad; // Negative because our angle system is inverted
        
        // Validate after setting
        validateVehicleState();
        
        // Store spawn position for reset
        spawnPosition = {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            angle: vehicle.angle
        };
        
        // Update camera positions
        const spawnCameraOffset = new THREE.Vector3(0, 8, 10);
        initialCameraPosition.set(
            pos.x + spawnCameraOffset.x,
            pos.y + spawnCameraOffset.y,
            pos.z + spawnCameraOffset.z
        );
        initialCameraLookAt.set(pos.x, 0, pos.z);
        
        // Reset vehicle state
        vehicle.velocity = 0;
        vehicle.steering = 0;
        vehicle.steeringActual = 0;
        vehicle.angularVelocity = 0;
        vehicle.tilt = 0;
        vehicle.tiltTarget = 0;
        
        // Update car visual position
        carGroup.position.set(vehicle.x, 0, vehicle.z);
        carGroup.rotation.y = -vehicle.angle;
        carGroup.rotation.z = 0;
        
        // Reset camera to follow position
        if (!adminCamera.enabled) {
            camera.position.copy(initialCameraPosition);
            camera.lookAt(initialCameraLookAt);
        } else {
            adminCamera.position.copy(initialCameraPosition);
            adminCamera.lookAt.copy(initialCameraLookAt);
            camera.position.copy(adminCamera.position);
            camera.lookAt(adminCamera.lookAt);
        }
        
        // Create spawn marker
        createSpawnMarker(pos.x, pos.y, pos.z);
        
        // Update status
        if (statusEl) {
            statusEl.textContent = `✓ Teleported to: ${data.address || `${data.lat.toFixed(6)}, ${data.lon.toFixed(6)}`}`;
            statusEl.style.color = '#4CAF50';
        }
        
        console.log(`Teleported to: ${data.address || `${data.lat}, ${data.lon}`} (node ${data.node_id})`);
        console.log(`Simulator position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
        
    } catch (error) {
        console.error('Teleportation error:', error);
        if (statusEl) {
            statusEl.textContent = `✗ Error: ${error.message}`;
            statusEl.style.color = '#ff4444';
        }
    }
}

// Wire up teleport button and input handlers (run after DOM is ready)
function setupTeleportUI() {
    const teleportBtn = document.getElementById('teleportBtn');
    const addressInput = document.getElementById('teleportAddress');
    const latInput = document.getElementById('teleportLat');
    const lonInput = document.getElementById('teleportLon');
    const yawInput = document.getElementById('teleportYaw');
    
    if (!teleportBtn) {
        // Retry if DOM not ready yet
        setTimeout(setupTeleportUI, 100);
        return;
    }
    
    teleportBtn.addEventListener('click', () => {
        const address = addressInput?.value.trim() || null;
        const lat = latInput?.value ? parseFloat(latInput.value) : null;
        const lon = lonInput?.value ? parseFloat(lonInput.value) : null;
        const yaw = yawInput?.value ? parseFloat(yawInput.value) : 0;
        
        // If address is provided, use it; otherwise use lat/lon
        if (address) {
            teleportCar(address, null, null, yaw);
        } else if (lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)) {
            teleportCar(null, lat, lon, yaw);
        } else {
            const statusEl = document.getElementById('teleportStatus');
            if (statusEl) {
                statusEl.textContent = '✗ Please enter an address or lat/lon coordinates';
                statusEl.style.color = '#ff4444';
            }
        }
    });
    
    // Allow Enter key to trigger teleportation
    [addressInput, latInput, lonInput, yawInput].forEach(input => {
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    teleportBtn.click();
                }
            });
        }
    });
}

// Setup teleport UI when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTeleportUI);
} else {
    setupTeleportUI();
}

// Wire up debug scoring controls
function setupDebugControls() {
    const debugSection = document.getElementById('debugSection');
    const consoleCheckbox = document.getElementById('debugScoringConsole');
    const visualsCheckbox = document.getElementById('debugScoringVisuals');
    const scoringInfo = document.getElementById('scoringInfo');

    if (!debugSection || !consoleCheckbox || !visualsCheckbox) {
        // Retry if DOM not ready
        setTimeout(setupDebugControls, 100);
        return;
    }

    // Wire up console logging toggle
    consoleCheckbox.addEventListener('change', (e) => {
        autopilot.debugScoring = e.target.checked;
        console.log(`Traffic light scoring debug logging: ${e.target.checked ? 'ON' : 'OFF'}`);
    });

    // Wire up visual debug toggle
    visualsCheckbox.addEventListener('change', (e) => {
        autopilot.debugScoringVisuals = e.target.checked;
        console.log(`Traffic light scoring visuals: ${e.target.checked ? 'ON' : 'OFF'}`);
    });

    // Initialize checkbox states from autopilot settings
    consoleCheckbox.checked = autopilot.debugScoring;
    visualsCheckbox.checked = autopilot.debugScoringVisuals;

    console.log('Debug controls initialized');
}

// Setup debug controls when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDebugControls);
} else {
    setupDebugControls();
}

// Update admin status indicator in UI
function updateAdminStatus(message) {
    let statusEl = document.getElementById('adminStatus');
    if (!statusEl) {
        // Create status element if it doesn't exist
        statusEl = document.createElement('div');
        statusEl.id = 'adminStatus';
        statusEl.style.cssText = 'position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: #ffaa00; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 12px; z-index: 1000;';
        document.body.appendChild(statusEl);
    }
    statusEl.textContent = message;
}

// Camera follow with smooth interpolation (normal mode)
function updateCamera() {
    // If admin mode is enabled, camera is controlled by adminCamera
    if (adminCamera.enabled) {
        return; // Camera update is handled in updateAdminCamera
    }
    
    // In three.js: X = left/right, Y = up, Z = forward/backward
    // Ground plane is in XZ plane, Y is vertical
    // Car movement: when angle=0, moves forward in -Z direction (toward camera)
    
    const offsetDistance = 12; // Distance behind vehicle
    const offsetHeight = 8; // Height above vehicle
    
    // Calculate offset: camera should be behind the car (opposite of facing direction)
    // When car faces direction 'angle', camera should be at 'angle + PI' (180 degrees behind)
    // Car forward direction is: (sin(angle), -cos(angle)) in XZ plane
    // Camera behind direction is: (-sin(angle), cos(angle)) in XZ plane
    
    const behindOffsetX = -Math.sin(vehicle.angle) * offsetDistance;
    const behindOffsetZ = Math.cos(vehicle.angle) * offsetDistance; // Positive because forward is -Z, so behind is +Z
    
    // Target camera position: vehicle position + behind offset
    const targetPosition = new THREE.Vector3(
        vehicle.x + behindOffsetX,
        offsetHeight,
        vehicle.z + behindOffsetZ
    );

    // Much smoother camera follow (slower lerping for less jaggy movement)
    camera.position.lerp(targetPosition, 0.05);

    // Look at a point slightly ahead of the vehicle (in the direction it's facing)
    const lookAheadDistance = 5;
    const aheadOffsetX = -Math.sin(vehicle.angle) * lookAheadDistance;
    const aheadOffsetZ = Math.cos(vehicle.angle) * lookAheadDistance;
    const lookTarget = new THREE.Vector3(
        vehicle.x + aheadOffsetX,
        1.2, // Look slightly above ground for better view
        vehicle.z + aheadOffsetZ
    );
    
    // Much smoother look-at for better camera behavior (slower interpolation)
    const currentDirection = new THREE.Vector3();
    camera.getWorldDirection(currentDirection);
    currentDirection.multiplyScalar(10).add(camera.position);
    
    const smoothLookTarget = new THREE.Vector3();
    smoothLookTarget.lerpVectors(currentDirection, lookTarget, 0.08);
    camera.lookAt(smoothLookTarget);
}

// Update UI
function updateUI() {
    document.getElementById('speed').textContent = 
        `Speed: ${vehicle.velocity.toFixed(1)} m/s (${(vehicle.velocity * 2.237).toFixed(1)} mph)`;
    document.getElementById('position').textContent = 
        `Position: (${vehicle.x.toFixed(1)}, ${vehicle.z.toFixed(1)})`;
    
    // Update autopilot status if enabled
    const waypointInfo = document.getElementById('autopilotStatus');
    if (autopilot.enabled && waypointInfo) {
        const progress = autopilot.currentWaypointIndex < autopilot.waypoints.length
            ? `${autopilot.currentWaypointIndex + 1}/${autopilot.waypoints.length}`
            : 'Complete';
        const currentWp = autopilot.currentWaypointIndex < autopilot.waypoints.length
            ? autopilot.waypoints[autopilot.currentWaypointIndex]
            : null;
        const distance = currentWp
            ? Math.sqrt(Math.pow(currentWp.x - vehicle.x, 2) + Math.pow(currentWp.z - vehicle.z, 2)).toFixed(1)
            : '0.0';
        waypointInfo.textContent = `🚗 Autopilot: Waypoint ${progress} | Distance: ${distance}m`;
        waypointInfo.style.color = '#00ff00';
        waypointInfo.style.display = 'block';

        // Traffic light compliance status
        const trafficLightStatusEl = document.getElementById('trafficLightStatus');
        if (trafficLightStatusEl) {
            if (autopilot.activeLight) {
                const state = autopilot.drivingState;
                const signal = autopilot.activeLight.signal;
                const dist = autopilot.activeLight.distance.toFixed(1);
                const yellowText = autopilot.yellowDecision ? ` | Yellow: ${autopilot.yellowDecision}` : '';
                trafficLightStatusEl.textContent = `🚦 ${state} | Signal: ${signal} | To stop: ${dist}m${yellowText}`;
                trafficLightStatusEl.style.display = 'block';
                trafficLightStatusEl.style.color = signal === 'GREEN' ? '#4caf50' : signal === 'YELLOW' ? '#ffc107' : '#f44336';
            } else {
                trafficLightStatusEl.textContent = '🚦 No active light';
                trafficLightStatusEl.style.display = 'block';
                trafficLightStatusEl.style.color = '#888';
            }
        }

        // Show debug section when autopilot is active
        const debugSection = document.getElementById('debugSection');
        if (debugSection) {
            debugSection.style.display = 'block';
            // Update scoring info
            const scoringInfo = document.getElementById('scoringInfo');
            if (scoringInfo && autopilot.activeLight && autopilot.activeLight.scoreBreakdown) {
                const sb = autopilot.activeLight.scoreBreakdown;
                scoringInfo.textContent = `Score: ${sb.total.toFixed(0)} (prox:${sb.proximity.toFixed(0)} head:${sb.headingAlignment.toFixed(0)} ahead:${sb.directlyAhead.toFixed(0)} side:${sb.approachSide.toFixed(0)} path:${sb.pathMatching.toFixed(0)} face:${sb.lightFacing.toFixed(0)})`;
            } else if (scoringInfo) {
                scoringInfo.textContent = '';
            }
        }
    } else if (waypointInfo) {
        waypointInfo.style.display = 'none';
        const trafficLightStatusEl = document.getElementById('trafficLightStatus');
        if (trafficLightStatusEl) trafficLightStatusEl.style.display = 'none';
        const debugSection = document.getElementById('debugSection');
        if (debugSection) debugSection.style.display = 'none';
    }

    // Debug: oscillation damping status
    if (autopilot.enabled) {
        updateOscillationDebugUI();
    }
}

// Animation loop
let lastTime = performance.now();

// Render debug visuals for autopilot route
function renderRouteDebugVisuals() {
    if (!autopilot.waypoints || autopilot.waypoints.length < 2) return;
    
    // Remove existing visuals if any
    if (routeLine) scene.remove(routeLine);
    if (waypointMarkerGroup) scene.remove(waypointMarkerGroup);
    
    // Create route line (green polyline)
    const points = autopilot.waypoints.map(wp => new THREE.Vector3(wp.x, 2, wp.z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 });
    routeLine = new THREE.Line(geometry, material);
    scene.add(routeLine);
    
    // Create waypoint markers
    waypointMarkerGroup = new THREE.Group();
    const markerGeometry = new THREE.ConeGeometry(2, 8, 8);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    
    autopilot.waypoints.forEach((wp, index) => {
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.set(wp.x, 4, wp.z);
        marker.rotation.x = Math.PI;
        waypointMarkerGroup.add(marker);
    });
    scene.add(waypointMarkerGroup);
    
    console.log("Route debug visuals rendered");
}

// Update waypoint marker position to highlight current target
function updateWaypointMarker() {
    if (!waypointMarkerGroup || !autopilot.enabled) return;
    
    // Highlight current waypoint (make it larger and different color)
    waypointMarkerGroup.children.forEach((marker, index) => {
        if (index === autopilot.currentWaypointIndex) {
            marker.material.color.setHex(0xff0000); // Red for current target
            marker.scale.set(1.5, 1.5, 1.5);
        } else if (index < autopilot.currentWaypointIndex) {
            marker.material.color.setHex(0x888888); // Gray for passed waypoints
            marker.scale.set(1.0, 1.0, 1.0);
        } else {
            marker.material.color.setHex(0xffff00); // Yellow for future waypoints
            marker.scale.set(1.0, 1.0, 1.0);
        }
    });
}

// ============================================================================
// HELPER FUNCTIONS (for autopilot)
// ============================================================================

/**
 * Calculate dynamic lookahead distance based on current speed
 * Closer lookahead at low speeds, farther at high speeds
 */
function calculateLookaheadDistance() {
    const speedBasedLookahead = Math.abs(vehicle.velocity) * autopilot.lookaheadGain;
    return Math.max(
        autopilot.minLookahead,
        Math.min(autopilot.maxLookahead, speedBasedLookahead)
    );
}

/**
 * Find lookahead point along the path using Pure Pursuit method
 * Projects vehicle onto current path segment, then walks forward by lookahead distance
 * Returns {x, z, waypointIndex} or null if path exhausted
 */
function computeLookaheadPoint() {
    const lookaheadDist = calculateLookaheadDistance();
    const currentIdx = autopilot.currentWaypointIndex;
    
    // Handle path completion
    if (currentIdx >= autopilot.waypoints.length) {
        return null;
    }
    
    // Get current path segment: prev_waypoint → current_waypoint
    let segmentStart, segmentEnd;
    
    if (currentIdx === 0) {
        // First waypoint: use vehicle position as segment start
        segmentStart = { x: vehicle.x, z: vehicle.z };
        segmentEnd = autopilot.waypoints[currentIdx];
    } else {
        segmentStart = autopilot.waypoints[currentIdx - 1];
        segmentEnd = autopilot.waypoints[currentIdx];
    }
    
    // Project vehicle position onto current segment
    const segDx = segmentEnd.x - segmentStart.x;
    const segDz = segmentEnd.z - segmentStart.z;
    const segLenSq = segDx * segDx + segDz * segDz;
    
    if (segLenSq < 0.001) {
        // Degenerate segment, use waypoint directly
        return {
            x: segmentEnd.x,
            z: segmentEnd.z,
            waypointIndex: currentIdx
        };
    }
    
    // Project vehicle onto segment
    const toVehicleX = vehicle.x - segmentStart.x;
    const toVehicleZ = vehicle.z - segmentStart.z;
    const t = Math.max(0, Math.min(1, (toVehicleX * segDx + toVehicleZ * segDz) / segLenSq));
    
    // Starting point on path (projected position)
    let pathX = segmentStart.x + t * segDx;
    let pathZ = segmentStart.z + t * segDz;
    let remainingDist = lookaheadDist;
    let searchIdx = currentIdx;
    let isOnInitialSegment = true;
    
    // Walk forward along path segments
    while (remainingDist > 0.01 && searchIdx < autopilot.waypoints.length) {
        // Current segment endpoints
        let segStart, segEnd;
        
        if (isOnInitialSegment) {
            // Still on initial segment (from projected point to current waypoint)
            segStart = { x: pathX, z: pathZ };
            segEnd = segmentEnd;
        } else {
            // On subsequent segments (from previous waypoint to next waypoint)
            segStart = autopilot.waypoints[searchIdx - 1];
            segEnd = autopilot.waypoints[searchIdx];
        }
        
        // Segment vector and length
        const dx = segEnd.x - segStart.x;
        const dz = segEnd.z - segStart.z;
        const segLen = Math.sqrt(dx * dx + dz * dz);
        
        if (segLen < 0.001) {
            // Skip degenerate segments
            isOnInitialSegment = false;
            searchIdx++;
            continue;
        }
        
        if (remainingDist <= segLen) {
            // Lookahead point is on this segment
            const ratio = remainingDist / segLen;
            return {
                x: segStart.x + dx * ratio,
                z: segStart.z + dz * ratio,
                waypointIndex: searchIdx
            };
        }
        
        // Consume this segment and continue to next
        remainingDist -= segLen;
        pathX = segEnd.x;
        pathZ = segEnd.z;
        isOnInitialSegment = false;
        searchIdx++;
    }
    
    // Reached end of path, return last waypoint
    const lastWp = autopilot.waypoints[autopilot.waypoints.length - 1];
    return {
        x: lastWp.x,
        z: lastWp.z,
        waypointIndex: autopilot.waypoints.length - 1
    };
}

/**
 * Calculate path curvature by analyzing upcoming waypoints
 * Returns curvature value (higher = sharper turn)
 * Used for anticipatory speed control
 */
function computePathCurvature() {
    const lookAhead = autopilot.curvatureLookahead;
    const startIdx = autopilot.currentWaypointIndex;
    const endIdx = Math.min(startIdx + lookAhead, autopilot.waypoints.length - 1);
    
    if (endIdx <= startIdx + 1) {
        return 0; // Not enough waypoints to detect curve
    }
    
    let totalAngleChange = 0;
    let totalPathLength = 0;
    
    for (let i = startIdx; i < endIdx; i++) {
        const wp1 = autopilot.waypoints[i];
        const wp2 = autopilot.waypoints[i + 1];
        
        // Calculate segment length
        const dx = wp2.x - wp1.x;
        const dz = wp2.z - wp1.z;
        const segmentLength = Math.sqrt(dx * dx + dz * dz);
        totalPathLength += segmentLength;
        
        // Calculate heading change
        if (i < endIdx - 1) {
            const wp3 = autopilot.waypoints[i + 2];
            
            const angle1 = Math.atan2(wp2.x - wp1.x, -(wp2.z - wp1.z));
            const angle2 = Math.atan2(wp3.x - wp2.x, -(wp3.z - wp2.z));
            
            let angleDiff = angle2 - angle1;
            
            // Normalize to [-PI, PI]
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            totalAngleChange += Math.abs(angleDiff);
        }
    }
    
    // Curvature = total angle change / path length
    if (totalPathLength < 0.1) return 0;
    
    return totalAngleChange / totalPathLength;
}

/**
 * Calculate target speed based on upcoming curvature AND distance to waypoint
 * CRITICAL: Anticipatory deceleration prevents overshooting waypoints
 * Only slows down for turns, not straight segments
 */
function speedFromCurvature(curvature) {
    // Base speed calculation from curvature
    const curvatureRatio = Math.min(curvature / autopilot.maxCurvature, 1.0);
    const curveBasedSpeed = autopilot.targetSpeedStraight * (1.0 - curvatureRatio) + 
                           autopilot.minTurnSpeed * curvatureRatio;
    
    // Distance-based deceleration ONLY if there's an actual turn ahead
    // Check if there's a significant turn angle at the upcoming waypoint
    const hasTurnAhead = checkForTurnAtNextWaypoint();
    
    // Only apply distance-based deceleration if there's a turn
    if (hasTurnAhead && autopilot.currentWaypointIndex < autopilot.waypoints.length) {
        const currentWp = autopilot.waypoints[autopilot.currentWaypointIndex];
        const distToWp = Math.sqrt(
            Math.pow(currentWp.x - vehicle.x, 2) + 
            Math.pow(currentWp.z - vehicle.z, 2)
        );
        
        // Start slowing down earlier (30m) for sharp turns, earlier braking
        const slowdownDistance = 30.0;
        if (distToWp < slowdownDistance) {
            // Cubic deceleration profile (harder initial braking)
            // distRatio^1.5 gives more aggressive early braking than distRatio^2
            const distRatio = distToWp / slowdownDistance;
            const decelFactor = Math.pow(distRatio, 1.5); // Cubic curve for harder initial braking
            const distBasedSpeed = autopilot.minTurnSpeed + 
                                  (curveBasedSpeed - autopilot.minTurnSpeed) * decelFactor;
            
            // Use the minimum of curve-based and distance-based speeds
            return Math.min(curveBasedSpeed, distBasedSpeed);
        }
    }
    
    return curveBasedSpeed;
}

/**
 * Detect steering oscillations and apply adaptive damping
 * Returns damping factor (1.0 = normal, <1.0 = damped)
 */
function detectAndDampOscillations(currentSteering) {
    const nowSec = performance.now() / 1000;
    const lastSec = autopilot._lastDampingUpdateSec;
    const dt = lastSec === null ? 0.016 : Math.max(0.001, Math.min(0.1, nowSec - lastSec));
    autopilot._lastDampingUpdateSec = nowSec;

    // Add current steering to history (time window)
    autopilot.steeringHistory.push({ t: nowSec, s: currentSteering });
    const cutoff = nowSec - (autopilot.oscillationWindowSec ?? 4.0);
    while (autopilot.steeringHistory.length > 0 && autopilot.steeringHistory[0].t < cutoff) {
        autopilot.steeringHistory.shift();
    }
    
    // Need at least 4 samples to detect oscillation
    if (autopilot.steeringHistory.length < 4) {
        return autopilot.dampingFactor;
    }
    
    // Count direction changes (sign flips)
    let directionChanges = 0;
    let sumAbsDelta = 0;
    const deadzone = autopilot.oscillationDeadzone ?? 0.02;
    let lastNonZeroSign = 0;
    for (let i = 1; i < autopilot.steeringHistory.length; i++) {
        const prev = autopilot.steeringHistory[i - 1].s;
        const curr = autopilot.steeringHistory[i].s;

        sumAbsDelta += Math.abs(curr - prev);
        
        // More sensitive sign-flip counting:
        // - Treat values inside deadzone as "no new info" (don’t reset sign to 0)
        // - Count flips between last known non-zero sign and the next non-zero sign
        const p = Math.abs(prev) < deadzone ? 0 : Math.sign(prev);
        const c = Math.abs(curr) < deadzone ? 0 : Math.sign(curr);

        if (p !== 0 && lastNonZeroSign === 0) lastNonZeroSign = p;
        if (c !== 0) {
            if (lastNonZeroSign !== 0 && c !== lastNonZeroSign) {
                directionChanges++;
            }
            lastNonZeroSign = c;
        }
    }

    const avgAbsDelta = sumAbsDelta / Math.max(1, autopilot.steeringHistory.length - 1);
    
    // Detect oscillation: too many direction changes in short time
    // Also require some magnitude so we don't trigger on tiny numerical jitter
    const oscillating =
        directionChanges >= autopilot.oscillationThreshold &&
        avgAbsDelta >= (autopilot.oscillationMinAvgDelta ?? 0.08);

    // Debug state for UI
    autopilot.oscActive = oscillating;
    autopilot.oscDirectionChanges = directionChanges;
    autopilot.oscAvgAbsDelta = avgAbsDelta;

    if (oscillating) {
        // Immediate, stronger damping
        autopilot.dampingFactor = Math.min(autopilot.dampingFactor, autopilot.dampingTarget);
    } else {
        // Time-based recovery back to 1.0 (fast, but smooth)
        autopilot.dampingFactor = Math.min(
            1.0,
            autopilot.dampingFactor + autopilot.dampingRecoveryRate * dt
        );
    }
    
    return autopilot.dampingFactor;
}

// Debug UI: show when oscillation damping is active
function updateOscillationDebugUI() {
    let el = document.getElementById('oscillationStatus');
    if (!el) {
        el = document.createElement('div');
        el.id = 'oscillationStatus';
        el.style.cssText = [
            'position:absolute',
            'left:10px',
            'bottom:10px',
            'background:rgba(0,0,0,0.7)',
            'color:#ffffff',
            'padding:8px 12px',
            'border-radius:4px',
            'font-family:monospace',
            'font-size:12px',
            'z-index:1000',
            'pointer-events:none'
        ].join(';');
        document.body.appendChild(el);
    }

    const active = !!autopilot.oscActive;
    const damping = (autopilot.dampingFactor ?? 1.0);
    el.textContent =
        `Oscillation: ${active ? 'ON' : 'OFF'} | damping=${damping.toFixed(2)} | flips=${autopilot.oscDirectionChanges ?? 0} | avgΔ=${(autopilot.oscAvgAbsDelta ?? 0).toFixed(2)}`;
    el.style.color = active ? '#ff6666' : '#aaffaa';
}

/**
 * Check if there's a significant turn angle at the next waypoint
 * Returns true if there's a turn > 15 degrees ahead
 */
function checkForTurnAtNextWaypoint() {
    // Need at least 2 waypoints ahead to detect a turn
    if (autopilot.currentWaypointIndex + 2 >= autopilot.waypoints.length) {
        return false; // No turn if we're at the end
    }
    
    const currentIdx = autopilot.currentWaypointIndex;
    const wp1 = currentIdx === 0 ? { x: vehicle.x, z: vehicle.z } : autopilot.waypoints[currentIdx - 1];
    const wp2 = autopilot.waypoints[currentIdx]; // Current waypoint we're heading to
    const wp3 = autopilot.waypoints[currentIdx + 1]; // Next waypoint after current
    
    // Calculate vectors
    const dx1 = wp2.x - wp1.x;
    const dz1 = wp2.z - wp1.z;
    const len1 = Math.sqrt(dx1 * dx1 + dz1 * dz1);
    
    const dx2 = wp3.x - wp2.x;
    const dz2 = wp3.z - wp2.z;
    const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
    
    // Skip if segments are too short
    if (len1 < 0.1 || len2 < 0.1) return false;
    
    // Normalize vectors
    const v1x = dx1 / len1;
    const v1z = dz1 / len1;
    const v2x = dx2 / len2;
    const v2z = dz2 / len2;
    
    // Compute angle between vectors using dot product
    const dot = v1x * v2x + v1z * v2z;
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const angle = Math.acos(clampedDot);
    
    // Return true if turn angle > 15 degrees (about 0.26 radians)
    const MIN_TURN_ANGLE = Math.PI / 12; // 15 degrees
    return angle > MIN_TURN_ANGLE;
}

/**
 * Compute pure-pursuit steering command
 * Uses geometric relationship between vehicle, lookahead point, and path
 */
function computePurePursuitSteering(lookaheadPoint) {
    if (!lookaheadPoint) return 0;
    
    // Vector from car to lookahead point
    const dx = lookaheadPoint.x - vehicle.x;
    const dz = lookaheadPoint.z - vehicle.z;
    
    // Desired heading (angle to lookahead point)
    const desiredHeading = Math.atan2(dx, -dz);
    
    // Heading error (how much we need to turn)
    let headingError = desiredHeading - vehicle.angle;
    
    // Normalize to [-PI, PI]
    while (headingError > Math.PI) headingError -= 2 * Math.PI;
    while (headingError < -Math.PI) headingError += 2 * Math.PI;
    
    // Apply steering gain (no proximity-based reduction - lookahead handles this)
    let effectiveGain = autopilot.steeringGain;
    
    // Detect oscillations and apply damping to steering gain
    const dampingFactor = detectAndDampOscillations(headingError * effectiveGain);
    effectiveGain *= dampingFactor;
    
    // Pure pursuit steering control (single steering objective)
    let steeringCommand = headingError * effectiveGain;
    
    // Clamp to max steering angle
    steeringCommand = Math.max(-vehicle.maxSteeringAngle, 
                              Math.min(vehicle.maxSteeringAngle, steeringCommand));
    
    return steeringCommand;
}

// ============================================================================
// TRAFFIC LIGHT COMPLIANCE (for autopilot) - FIXED VERSION
// ============================================================================

/**
 * Get current signal for an approach (straight movement) from intersection phase
 */
function getCurrentSignalForApproach(trafficLight, isNS) {
    const phase = trafficLight.signalState.currentPhase;
    if (phase === 'YELLOW_NS') return isNS ? 'YELLOW' : 'RED';
    if (phase === 'YELLOW_EW') return isNS ? 'RED' : 'YELLOW';
    if (phase === 'NS_STRAIGHT' || phase === 'NS_LEFT') return isNS ? 'GREEN' : 'RED';
    if (phase === 'EW_STRAIGHT' || phase === 'EW_LEFT') return isNS ? 'RED' : 'GREEN';
    return 'RED';
}

/**
 * Detect if the vehicle intends to turn based on upcoming waypoints.
 * Returns 'left', 'right', or 'straight'
 */
function detectTurnIntent() {
    if (!autopilot.waypoints || autopilot.waypoints.length < 3) return 'straight';

    const idx = autopilot.currentWaypointIndex;
    if (idx + 2 >= autopilot.waypoints.length) return 'straight';

    const wp0 = autopilot.waypoints[idx];
    const wp1 = autopilot.waypoints[idx + 1];
    const wp2 = autopilot.waypoints[idx + 2];

    // Direction from current to next waypoint
    const dir1x = wp1.x - wp0.x;
    const dir1z = wp1.z - wp0.z;
    const len1 = Math.sqrt(dir1x * dir1x + dir1z * dir1z);

    // Direction from next to next+1 waypoint
    const dir2x = wp2.x - wp1.x;
    const dir2z = wp2.z - wp1.z;
    const len2 = Math.sqrt(dir2x * dir2x + dir2z * dir2z);

    if (len1 < 0.1 || len2 < 0.1) return 'straight';

    // Normalize
    const n1x = dir1x / len1, n1z = dir1z / len1;
    const n2x = dir2x / len2, n2z = dir2z / len2;

    // Cross product Z (2D): positive = left turn, negative = right turn
    const cross = n1x * n2z - n1z * n2x;

    // Dot product for angle
    const dot = n1x * n2x + n1z * n2z;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    // Turn threshold: ~30 degrees
    const TURN_THRESHOLD = Math.PI / 6;

    if (angle > TURN_THRESHOLD) {
        return cross > 0 ? 'left' : 'right';
    }
    return 'straight';
}

/**
 * Build list of traffic light control points.
 * Includes both straight and turn lights, with turn intent awareness.
 * FIXED: Better filtering of cross-traffic lights
 */
function getTrafficLightControlPoints() {
    const points = [];
    const turnIntent = detectTurnIntent();

    trafficLights.forEach(tl => {
        const intersectionPos = new THREE.Vector3(tl.intersection.position.x, 0, tl.intersection.position.z);

        // Group lights by approach to handle straight vs turn lights properly
        const approachLights = new Map(); // approachKey -> {straight: light, left: light}

        tl.lights.forEach(light => {
            const approachKey = `${light.approach.approachDirection.x.toFixed(3)}_${light.approach.approachDirection.z.toFixed(3)}`;
            if (!approachLights.has(approachKey)) {
                approachLights.set(approachKey, { straight: null, left: null });
            }
            if (light.type === 'straight') {
                approachLights.get(approachKey).straight = light;
            } else if (light.type === 'left') {
                approachLights.get(approachKey).left = light;
            }
        });

        // For each approach, select the appropriate light based on turn intent
        approachLights.forEach((lights, approachKey) => {
            // Prefer left-turn light if intending to turn left and one exists
            // Otherwise use straight light
            let selectedLight = lights.straight;
            if (turnIntent === 'left' && lights.left) {
                selectedLight = lights.left;
            }

            if (!selectedLight) return;

            const light = selectedLight;
            const approachDir = light.approach.approachDirection.clone();

            // Get the correct signal for this light type
            let signal;
            if (light.type === 'left') {
                signal = getCurrentLeftTurnSignal(tl, light.isNS);
            } else {
                signal = getCurrentSignalForApproach(tl, light.isNS);
            }

            const stopOffset = autopilot.stopOffset;
            const stopPoint = intersectionPos.clone().sub(approachDir.clone().multiplyScalar(stopOffset));
            const poleWorld = new THREE.Vector3();
            light.mesh.group.getWorldPosition(poleWorld);

            // Light facing direction: lights are rotated to face incoming traffic (opposite to approachDir)
            const lightFacing = approachDir.clone().multiplyScalar(-1);

            points.push({
                intersectionPos: intersectionPos.clone(),
                approachDir,
                stopPoint,
                signal,
                trafficLight: tl,
                approach: light.approach,
                poleWorldPosition: poleWorld.clone(),
                lightFacing: lightFacing,
                lightType: light.type,
                turnIntent: turnIntent,
                isNS: light.isNS // Include NS/EW classification for debugging
            });
        });
    });
    return points;
}

/**
 * Get the current signal for a left-turn light
 */
function getCurrentLeftTurnSignal(trafficLight, isNS) {
    const phase = trafficLight.signalState.currentPhase;
    // Left turn phases: NS_LEFT gives green to NS left-turners, EW_LEFT to EW left-turners
    if (phase === 'NS_LEFT') return isNS ? 'GREEN' : 'RED';
    if (phase === 'EW_LEFT') return isNS ? 'RED' : 'GREEN';
    // During straight phases, left-turn is red
    return 'RED';
}

/**
 * Get the active traffic light for the vehicle using an improved scoring system.
 * FIXED: Much stricter filtering to prevent selecting cross-traffic lights
 * @param {THREE.Vector3} vehiclePos
 * @param {number} vehicleHeading
 * @param {THREE.Vector3|null} pathDirection - optional; segment direction for better matching
 */
function getActiveTrafficLight(vehiclePos, vehicleHeading, pathDirection) {
    const points = getTrafficLightControlPoints();
    if (points.length === 0) return null;

    const vx = Math.sin(vehicleHeading);
    const vz = -Math.cos(vehicleHeading); // Fixed: negative cos for proper forward direction
    const forward = new THREE.Vector3(vx, 0, vz);
    const radius = autopilot.forwardSearchRadius;
    const weights = autopilot.scoringWeights;

    let bestLight = null;
    let bestScore = -Infinity;
    const candidateScores = []; // For debug output

    const vehicleToIntersection = new THREE.Vector3();
    const toStop = new THREE.Vector3();

    points.forEach((p, index) => {
        toStop.set(
            p.stopPoint.x - vehiclePos.x,
            0,
            p.stopPoint.z - vehiclePos.z
        );
        const dist = toStop.length();

        // Initialize score breakdown for debugging
        const scoreBreakdown = {
            index,
            distance: dist,
            signal: p.signal,
            lightType: p.lightType || 'straight',
            turnIntent: p.turnIntent || 'straight',
            isNS: p.isNS,
            filtered: false,
            filterReason: null,
            proximity: 0,
            headingAlignment: 0,
            directlyAhead: 0,
            approachSide: 0,
            pathMatching: 0,
            lightFacing: 0,
            total: 0
        };

        // Hard filter: must be within search radius
        if (dist > radius) {
            scoreBreakdown.filtered = true;
            scoreBreakdown.filterReason = `distance ${dist.toFixed(1)}m > radius ${radius}m`;
            if (autopilot.debugScoring) candidateScores.push(scoreBreakdown);
            return;
        }

        toStop.normalize();

        // Hard filter: must be ahead of vehicle (STRICTER threshold)
        const aheadDot = toStop.dot(forward);
        if (aheadDot < 0.6) { // Increased from 0.5 to 0.6 for stricter forward requirement
            scoreBreakdown.filtered = true;
            scoreBreakdown.filterReason = `not ahead (aheadDot=${aheadDot.toFixed(2)} < 0.6)`;
            if (autopilot.debugScoring) candidateScores.push(scoreBreakdown);
            return;
        }

        // CRITICAL FIX: Strict approach direction alignment
        // approachDir points toward the intersection (direction of travel for that lane)
        // For our lane: approachDir should roughly match our heading (positive dot)
        // Cross-traffic: dot ~0 (perpendicular)
        // Oncoming traffic: dot < 0 (opposite direction)
        const approachAlignment = p.approachDir.dot(forward);
        
        // MUCH stricter threshold: must be nearly parallel (cos(30°) ≈ 0.866)
        const strictAlignThreshold = 0.8; // Was 0.7, now stricter
        if (approachAlignment < strictAlignThreshold) {
            scoreBreakdown.filtered = true;
            scoreBreakdown.filterReason = `wrong lane/cross-traffic (approachAlign=${approachAlignment.toFixed(2)} < ${strictAlignThreshold})`;
            if (autopilot.debugScoring) candidateScores.push(scoreBreakdown);
            return;
        }

        // ADDITIONAL FILTER: Check that vehicle is on the correct side of the intersection
        // (approaching, not past it)
        vehicleToIntersection.set(
            p.intersectionPos.x - vehiclePos.x,
            0,
            p.intersectionPos.z - vehiclePos.z
        );
        const distToIntersection = vehicleToIntersection.length();
        
        if (distToIntersection > 0.1) {
            vehicleToIntersection.normalize();
            // Vehicle should be approaching from the approach direction side
            const onApproachSide = vehicleToIntersection.dot(p.approachDir);
            
            // If negative, vehicle is on the wrong side (past the intersection)
            if (onApproachSide < 0.2) { // Slightly more lenient to catch late detection
                scoreBreakdown.filtered = true;
                scoreBreakdown.filterReason = `past intersection (onApproachSide=${onApproachSide.toFixed(2)} < 0.2)`;
                if (autopilot.debugScoring) candidateScores.push(scoreBreakdown);
                return;
            }
        }

        // === SCORING SYSTEM ===
        let score = 0;

        // Factor 1: Proximity (closer is better, but not too aggressive)
        const proximityScore = weights.proximity * Math.exp(-dist / 25.0); // Slightly less aggressive
        score += proximityScore;
        scoreBreakdown.proximity = proximityScore;

        // Factor 2: Heading alignment (driving toward intersection in approach direction)
        // This is now the MOST important factor since cross-traffic is filtered
        const alignScore = Math.pow(Math.max(0, approachAlignment), 2) * weights.headingAlignment; // Squared for stronger preference
        score += alignScore;
        scoreBreakdown.headingAlignment = alignScore;

        // Factor 3: Stop point directly ahead (not off to the side)
        const aheadScore = Math.pow(Math.max(0, aheadDot), 2) * weights.directlyAhead; // Squared
        score += aheadScore;
        scoreBreakdown.directlyAhead = aheadScore;

        // Factor 4: Vehicle is on the approach side of intersection
        let sideScore = 0;
        if (distToIntersection > 0.1) {
            const onApproachSide = vehicleToIntersection.dot(p.approachDir);
            sideScore = Math.max(0, onApproachSide) * weights.approachSide;
            score += sideScore;
        }
        scoreBreakdown.approachSide = sideScore;

        // Factor 5: Path direction matching (if available) - INCREASED WEIGHT
        let pathScore = 0;
        if (pathDirection && pathDirection.lengthSq() > 0.01) {
            const pathAlign = p.approachDir.dot(pathDirection);
            // Only count if strongly aligned
            if (pathAlign > 0.7) {
                pathScore = Math.pow(pathAlign, 2) * weights.pathMatching * 1.5; // Boosted
            }
            score += pathScore;
        }
        scoreBreakdown.pathMatching = pathScore;

        // Factor 6: Light facing toward vehicle (bonus, not critical)
        let facingScore = 0;
        const distAlongApproach =
            (p.intersectionPos.x - vehiclePos.x) * p.approachDir.x +
            (p.intersectionPos.z - vehiclePos.z) * p.approachDir.z;
        const pastPole = distAlongApproach < 8.0;

        if (!pastPole && p.poleWorldPosition && p.lightFacing) {
            const lightToVehicle = new THREE.Vector3(
                vehiclePos.x - p.poleWorldPosition.x,
                0,
                vehiclePos.z - p.poleWorldPosition.z
            );
            if (lightToVehicle.lengthSq() > 0.01) {
                lightToVehicle.normalize();
                const facing = p.lightFacing.dot(lightToVehicle);
                if (facing > 0.5) { // Only count if light is actually facing us
                    facingScore = Math.max(0, facing) * weights.lightFacing;
                    score += facingScore;
                }
            }
        }
        scoreBreakdown.lightFacing = facingScore;
        scoreBreakdown.total = score;

        if (autopilot.debugScoring) candidateScores.push(scoreBreakdown);

        // Update best light if this scores higher
        if (score > bestScore) {
            bestScore = score;
            bestLight = {
                stopPoint: p.stopPoint,
                signal: p.signal,
                distance: dist,
                approachDir: p.approachDir,
                intersectionPos: p.intersectionPos,
                controlPoint: p,
                poleWorldPosition: p.poleWorldPosition ? p.poleWorldPosition.clone() : null,
                score: score,
                scoreBreakdown: scoreBreakdown // Include breakdown for debugging
            };
        }
    });

    // Comprehensive debug output
    if (autopilot.debugScoring && autopilot.enabled && candidateScores.length > 0) {
        console.group('Traffic Light Scoring');
        console.log(`Vehicle pos: (${vehiclePos.x.toFixed(1)}, ${vehiclePos.z.toFixed(1)}), heading: ${(vehicleHeading * 180 / Math.PI).toFixed(1)}°`);
        console.log(`Forward vector: (${forward.x.toFixed(2)}, ${forward.z.toFixed(2)})`);
        console.log(`Path direction: ${pathDirection ? `(${pathDirection.x.toFixed(2)}, ${pathDirection.z.toFixed(2)})` : 'N/A'}`);
        console.log(`Turn intent: ${candidateScores[0]?.turnIntent || 'straight'}`);
        console.log(`Candidates: ${candidateScores.length}`);

        candidateScores.sort((a, b) => b.total - a.total);

        candidateScores.forEach((s, i) => {
            if (s.filtered) {
                console.log(`  [${i}] FILTERED (${s.lightType}, ${s.isNS ? 'NS' : 'EW'}): ${s.filterReason}`);
            } else {
                const isSelected = bestLight && s.total === bestLight.score;
                const marker = isSelected ? '→' : ' ';
                console.log(
                    `${marker} [${i}] ${s.signal} (${s.lightType}, ${s.isNS ? 'NS' : 'EW'}) dist=${s.distance.toFixed(1)}m | ` +
                    `prox=${s.proximity.toFixed(1)} head=${s.headingAlignment.toFixed(1)} ` +
                    `ahead=${s.directlyAhead.toFixed(1)} side=${s.approachSide.toFixed(1)} ` +
                    `path=${s.pathMatching.toFixed(1)} face=${s.lightFacing.toFixed(1)} | ` +
                    `TOTAL=${s.total.toFixed(1)}`
                );
            }
        });
        console.groupEnd();
    }

    return bestLight;
}

/**
 * Get current path segment direction (vehicle toward next waypoint) for traffic light matching.
 * Returns normalized Vector3 or null if not available.
 */
function getPathDirectionTowardNextWaypoint() {
    if (!autopilot.waypoints || autopilot.waypoints.length < 2) return null;
    const idx = autopilot.currentWaypointIndex;
    if (idx >= autopilot.waypoints.length) return null;
    
    // Use current vehicle position to next waypoint for more accurate direction
    const segEnd = autopilot.waypoints[idx];
    const dx = segEnd.x - vehicle.x;
    const dz = segEnd.z - vehicle.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.1) return null;
    return new THREE.Vector3(dx / len, 0, dz / len);
}

/**
 * Update traffic light compliance state machine and return effective target speed
 * FIXED: More aggressive braking, better stop point handling
 */
function applyTrafficLightCompliance(baseTargetSpeed) {
    if (!autopilot.enabled || trafficLights.length === 0) return baseTargetSpeed;

    const pos = new THREE.Vector3(vehicle.x, 0, vehicle.z);
    const heading = vehicle.angle;
    const pathDir = getPathDirectionTowardNextWaypoint();
    const active = getActiveTrafficLight(pos, heading, pathDir);

    autopilot.activeLight = active;

    // No relevant light
    if (!active) {
        autopilot.yellowDecision = null;
        // If we were STOPPED/STOPPING at a light and lost detection, check if we should stay stopped
        const stopped = autopilot.stoppedAtIntersection;
        if (stopped && (autopilot.drivingState === 'STOPPED' || autopilot.drivingState === 'STOPPING')) {
            // Calculate if we've cleared the intersection
            const pastCenter = (vehicle.x - stopped.intersectionPos.x) * stopped.approachDir.x +
                (vehicle.z - stopped.intersectionPos.z) * stopped.approachDir.z;
            
            // Stay stopped until we're well past the intersection center (15m to be safe)
            if (pastCenter < 15) {
                return 0;
            }
            autopilot.stoppedAtIntersection = null;
        } else if (autopilot.stoppedAtIntersection) {
            autopilot.stoppedAtIntersection = null;
        }
        
        if (autopilot.drivingState === 'STOPPED' || autopilot.drivingState === 'PROCEEDING') {
            autopilot.drivingState = 'NORMAL';
        } else if (autopilot.drivingState !== 'NORMAL') {
            autopilot.drivingState = 'NORMAL';
        }
        return baseTargetSpeed;
    }

    const distToStop = active.distance;
    const signal = active.signal;

    // FIXED: Better "past stop line" detection
    // Only consider past if we're well beyond the stop point AND past the intersection center
    const vectorToStop = new THREE.Vector3(
        active.stopPoint.x - vehicle.x,
        0,
        active.stopPoint.z - vehicle.z
    );
    const distanceAlongApproach = vectorToStop.dot(active.approachDir);
    
    // Positive means stop point is still ahead, negative means we've passed it
    const pastStopPoint = distanceAlongApproach < -3.0; // 3m past stop point
    
    const pastCenter = (vehicle.x - active.intersectionPos.x) * active.approachDir.x +
        (vehicle.z - active.intersectionPos.z) * active.approachDir.z;
    
    // Only clear the light if we're BOTH past the stop point AND past the intersection center
    if (pastStopPoint && pastCenter > 10) {
        autopilot.yellowDecision = null;
        autopilot.stoppedAtIntersection = null;
        autopilot.drivingState = 'NORMAL';
        return baseTargetSpeed;
    }

    // Yellow: lock decision on first detection (with better calculation)
    if (signal === 'YELLOW' && autopilot.yellowDecision === null) {
        // Calculate if we can stop safely
        // Use physics: stopping distance = v² / (2 * deceleration)
        const currentSpeed = Math.abs(vehicle.velocity);
        const comfortableDecel = 4.0; // m/s² - comfortable deceleration
        const stoppingDist = (currentSpeed * currentSpeed) / (2 * comfortableDecel);
        
        // Add safety margin
        const canStop = distToStop > (stoppingDist + 5.0); // 5m safety margin
        autopilot.yellowDecision = canStop ? 'STOP' : 'GO';
        
        if (autopilot.debugScoring) {
            console.log(`Yellow decision: ${autopilot.yellowDecision} (dist=${distToStop.toFixed(1)}m, stopping=${stoppingDist.toFixed(1)}m)`);
        }
    }

    const mustStop = signal === 'RED' || (signal === 'YELLOW' && autopilot.yellowDecision === 'STOP');

    // State transitions
    switch (autopilot.drivingState) {
        case 'NORMAL':
            if (mustStop && distToStop < autopilot.brakingDistance) {
                autopilot.drivingState = Math.abs(vehicle.velocity) > 0.5 ? 'STOPPING' : 'STOPPED';
                if (autopilot.drivingState === 'STOPPED') {
                    autopilot.stoppedAtIntersection = {
                        intersectionPos: active.intersectionPos.clone(),
                        approachDir: active.approachDir.clone()
                    };
                }
            } else if (mustStop && distToStop <= autopilot.brakingDistance * 1.5) {
                autopilot.drivingState = 'APPROACHING_LIGHT';
            }
            break;
            
        case 'APPROACHING_LIGHT':
            if (!mustStop) {
                autopilot.drivingState = 'PROCEEDING';
                autopilot.stoppedAtIntersection = null;
            } else if (Math.abs(vehicle.velocity) > 0.5 && distToStop < autopilot.brakingDistance) {
                autopilot.drivingState = 'STOPPING';
            } else if (Math.abs(vehicle.velocity) <= 0.5 && distToStop < 8) {
                autopilot.drivingState = 'STOPPED';
                autopilot.stoppedAtIntersection = {
                    intersectionPos: active.intersectionPos.clone(),
                    approachDir: active.approachDir.clone()
                };
            }
            break;
            
        case 'STOPPING':
            if (Math.abs(vehicle.velocity) <= 0.1 && distToStop <= autopilot.stopOffset + 5) {
                autopilot.drivingState = 'STOPPED';
                autopilot.stoppedAtIntersection = {
                    intersectionPos: active.intersectionPos.clone(),
                    approachDir: active.approachDir.clone()
                };
            } else if (!mustStop) {
                autopilot.drivingState = 'PROCEEDING';
                autopilot.stoppedAtIntersection = null;
            }
            break;
            
        case 'STOPPED':
            if (signal === 'GREEN') {
                autopilot.yellowDecision = null;
                autopilot.drivingState = 'PROCEEDING';
                autopilot.stoppedAtIntersection = null;
            }
            break;
            
        case 'PROCEEDING':
            // Stay in proceeding until well past the intersection
            if (pastCenter > 15) {
                autopilot.drivingState = 'NORMAL';
                autopilot.yellowDecision = null;
                autopilot.stoppedAtIntersection = null;
            }
            break;
    }

    // FIXED: More aggressive speed control
    if (autopilot.drivingState === 'STOPPED') {
        return 0;
    }
    
    if (autopilot.drivingState === 'STOPPING' || (mustStop && autopilot.drivingState === 'APPROACHING_LIGHT')) {
        // MUCH more aggressive braking curve
        // Stop well before the line (at stopOffset distance before intersection)
        
        if (distToStop <= 3.0) {
            // Very close - full stop
            return 0;
        }
        
        if (distToStop <= 8.0) {
            // Close - very slow crawl
            return Math.min(2.0, baseTargetSpeed * 0.1);
        }
        
        if (distToStop <= 15.0) {
            // Medium distance - slow approach
            const ratio = (distToStop - 3.0) / 12.0; // 3m to 15m range
            return Math.min(baseTargetSpeed * 0.3, 5.0) * ratio;
        }
        
        // Further out - gradual deceleration
        const brakeStart = autopilot.brakingDistance;
        const ratio = Math.min(1.0, (distToStop - 15.0) / (brakeStart - 15.0));
        const smoothSpeed = baseTargetSpeed * ratio * ratio; // Quadratic for smoother approach
        return Math.max(0, Math.min(baseTargetSpeed, smoothSpeed));
    }
    
    if (autopilot.drivingState === 'PROCEEDING') {
        return baseTargetSpeed; // Resume normal waypoint-following speed
    }

    return baseTargetSpeed;
}


/**
 * Update traffic light debug visuals (stop point marker, active light highlight)
 */
function updateTrafficLightDebugVisuals() {
    if (!trafficLightDebugGroup) {
        trafficLightDebugGroup = new THREE.Group();
        scene.add(trafficLightDebugGroup);
    }
    while (trafficLightDebugGroup.children.length > 0) {
        trafficLightDebugGroup.remove(trafficLightDebugGroup.children[0]);
    }

    if (!autopilot.enabled || !autopilot.activeLight) return;

    const active = autopilot.activeLight;
    const stopPointGeo = new THREE.SphereGeometry(2.5, 16, 16);
    const stopPointMat = new THREE.MeshBasicMaterial({
        color: active.signal === 'GREEN' ? 0x00ff00 : active.signal === 'YELLOW' ? 0xffff00 : 0xff0000,
        transparent: true,
        opacity: 0.8
    });
    const stopMarker = new THREE.Mesh(stopPointGeo, stopPointMat);
    stopMarker.position.copy(active.stopPoint);
    stopMarker.position.y = 1.5;
    trafficLightDebugGroup.add(stopMarker);

    const ringGeo = new THREE.RingGeometry(2, 4, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(active.stopPoint);
    trafficLightDebugGroup.add(ring);

    // Highlight active traffic light pole (wireframe cylinder at base)
    if (active.poleWorldPosition) {
        const poleHighlightGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.5, 16);
        const poleHighlightMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            wireframe: true,
            transparent: true,
            opacity: 0.9
        });
        const poleHighlight = new THREE.Mesh(poleHighlightGeo, poleHighlightMat);
        poleHighlight.position.copy(active.poleWorldPosition);
        poleHighlight.position.y = 0.25;
        trafficLightDebugGroup.add(poleHighlight);
    }
}

/**
 * Update traffic light scoring debug visuals
 * Shows lines from vehicle to each candidate light, color-coded by score
 */
function updateScoringDebugVisuals() {
    // Initialize group if needed
    if (!scoringVisualsGroup) {
        scoringVisualsGroup = new THREE.Group();
        scene.add(scoringVisualsGroup);
    }

    // Clear previous visuals
    while (scoringVisualsGroup.children.length > 0) {
        const child = scoringVisualsGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
        scoringVisualsGroup.remove(child);
    }

    if (!autopilot.enabled || !autopilot.debugScoringVisuals) return;

    const vehiclePos = new THREE.Vector3(vehicle.x, 0, vehicle.z);
    const vehicleHeading = vehicle.angle;
    const pathDir = getPathDirectionTowardNextWaypoint();

    // Get all traffic light control points and compute scores
    const points = getTrafficLightControlPoints();
    if (points.length === 0) return;

    const vx = Math.sin(vehicleHeading);
    const vz = Math.cos(vehicleHeading);
    const forward = new THREE.Vector3(vx, 0, vz);
    const radius = autopilot.forwardSearchRadius;
    const weights = autopilot.scoringWeights;

    const scoredPoints = [];
    let maxScore = 0;
    let bestIndex = -1;

    points.forEach((p, index) => {
        const toStop = new THREE.Vector3(
            p.stopPoint.x - vehiclePos.x,
            0,
            p.stopPoint.z - vehiclePos.z
        );
        const dist = toStop.length();

        // Check hard filters
        if (dist > radius) {
            scoredPoints.push({ point: p, score: -1, filtered: true, reason: 'distance' });
            return;
        }

        const toStopNorm = toStop.clone().normalize();
        const aheadDot = toStopNorm.dot(forward);

        if (aheadDot < 0.2) {
            scoredPoints.push({ point: p, score: -1, filtered: true, reason: 'behind' });
            return;
        }

        // Calculate score (simplified version for visualization)
        let score = 0;
        score += weights.proximity * Math.exp(-dist / 20.0);
        score += Math.max(0, p.approachDir.dot(forward)) * weights.headingAlignment;
        score += Math.max(0, aheadDot) * weights.directlyAhead;

        const vehicleToIntersection = new THREE.Vector3(
            p.intersectionPos.x - vehiclePos.x,
            0,
            p.intersectionPos.z - vehiclePos.z
        ).normalize();
        score += Math.max(0, vehicleToIntersection.dot(p.approachDir)) * weights.approachSide;

        if (pathDir && pathDir.lengthSq() > 0.01) {
            score += Math.max(0, p.approachDir.dot(pathDir)) * weights.pathMatching;
        }

        scoredPoints.push({ point: p, score, filtered: false, index });

        if (score > maxScore) {
            maxScore = score;
            bestIndex = index;
        }
    });

    // Draw visuals for each scored point
    scoredPoints.forEach((sp, i) => {
        const p = sp.point;
        const stopPos = p.stopPoint.clone();
        stopPos.y = 2;

        const vehicleDrawPos = vehiclePos.clone();
        vehicleDrawPos.y = 2;

        // Create line from vehicle to stop point
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([vehicleDrawPos, stopPos]);

        let lineColor;
        if (sp.filtered) {
            lineColor = 0x666666; // Gray for filtered
        } else if (sp.index === bestIndex) {
            lineColor = 0x00ff00; // Green for selected
        } else {
            // Gradient from red (low score) to yellow (high score)
            const normalizedScore = maxScore > 0 ? sp.score / maxScore : 0;
            const r = 1.0;
            const g = normalizedScore;
            const b = 0;
            lineColor = new THREE.Color(r, g, b);
        }

        const lineMaterial = new THREE.LineBasicMaterial({
            color: lineColor,
            transparent: true,
            opacity: sp.filtered ? 0.3 : 0.8,
            linewidth: sp.index === bestIndex ? 3 : 1
        });

        const line = new THREE.Line(lineGeometry, lineMaterial);
        scoringVisualsGroup.add(line);

        // Add score label (sphere with size based on score)
        if (!sp.filtered) {
            const normalizedScore = maxScore > 0 ? sp.score / maxScore : 0;
            const sphereSize = 0.5 + normalizedScore * 1.5;

            const sphereGeo = new THREE.SphereGeometry(sphereSize, 8, 8);
            const sphereMat = new THREE.MeshBasicMaterial({
                color: sp.index === bestIndex ? 0x00ff00 : 0xffaa00,
                transparent: true,
                opacity: 0.7
            });
            const sphere = new THREE.Mesh(sphereGeo, sphereMat);
            sphere.position.copy(stopPos);
            sphere.position.y = 4;
            scoringVisualsGroup.add(sphere);

            // Add ring around selected light
            if (sp.index === bestIndex) {
                const ringGeo = new THREE.RingGeometry(3, 4, 32);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: 0x00ff00,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.5
                });
                const ring = new THREE.Mesh(ringGeo, ringMat);
                ring.rotation.x = -Math.PI / 2;
                ring.position.copy(p.intersectionPos);
                ring.position.y = 0.1;
                scoringVisualsGroup.add(ring);
            }
        }
    });

    // Draw approach direction arrows for each candidate
    scoredPoints.forEach(sp => {
        if (sp.filtered) return;

        const p = sp.point;
        const arrowStart = p.intersectionPos.clone();
        arrowStart.y = 1;
        const arrowEnd = arrowStart.clone().sub(p.approachDir.clone().multiplyScalar(10));
        arrowEnd.y = 1;

        const arrowGeometry = new THREE.BufferGeometry().setFromPoints([arrowStart, arrowEnd]);
        const arrowMaterial = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.5
        });
        const arrow = new THREE.Line(arrowGeometry, arrowMaterial);
        scoringVisualsGroup.add(arrow);
    });
}

// ============================================================================
// AUTOPILOT UPDATE FUNCTION
// ============================================================================

// Autopilot update function (waypoint-following logic)
function updateAutopilot(deltaTime) {
    if (!autopilot.enabled || autopilot.currentWaypointIndex >= autopilot.waypoints.length) {
        // Autopilot complete or disabled - coast to stop
        vehicle.velocity = THREE.MathUtils.lerp(vehicle.velocity, 0, 0.1);
        vehicle.acceleration = 0;
        vehicle.steering = THREE.MathUtils.lerp(vehicle.steering, 0, 0.1);
        return;
    }
    
    // Step 1: Check if current waypoint is reached
    const currentWp = autopilot.waypoints[autopilot.currentWaypointIndex];
    
    if (!currentWp || !isFinite(currentWp.x) || !isFinite(currentWp.z)) {
        console.error(`Invalid waypoint at index ${autopilot.currentWaypointIndex}`);
        autopilot.currentWaypointIndex++;
        autopilot.lastWaypointDistance = Infinity;
        return;
    }
    
    const dx = currentWp.x - vehicle.x;
    const dz = currentWp.z - vehicle.z;
    const distanceToWaypoint = Math.sqrt(dx * dx + dz * dz);
    
    // Check if we're within threshold
    const withinThreshold = distanceToWaypoint < autopilot.waypointThreshold;
    
    // Check if we've passed the waypoint (only if we were close and are now moving away)
    // This helps catch cases where we take a wide turn and miss the waypoint
    const wasClose = autopilot.lastWaypointDistance < autopilot.waypointThreshold * 2.0;
    const movingAway = distanceToWaypoint > autopilot.lastWaypointDistance + 2.0; // Must be moving away by at least 2m
    const passedWaypoint = wasClose && movingAway && isFinite(autopilot.lastWaypointDistance);
    
    if (withinThreshold || passedWaypoint) {
        // Waypoint reached or passed, advance
        autopilot.currentWaypointIndex++;
        autopilot.lastWaypointDistance = Infinity;
        updateWaypointMarker();
        
        if (autopilot.currentWaypointIndex >= autopilot.waypoints.length) {
            console.log("✅ Route complete! All waypoints reached.");
            autopilot.enabled = false;
            return;
        }
        
        console.log(`Waypoint ${autopilot.currentWaypointIndex - 1} ${passedWaypoint ? 'passed' : 'reached'}, advancing to ${autopilot.currentWaypointIndex}`);
    } else {
        // Update last distance for next frame
        autopilot.lastWaypointDistance = distanceToWaypoint;
    }
    
    // Step 2: Compute lookahead point
    const lookaheadPoint = computeLookaheadPoint();
    
    if (!lookaheadPoint) {
        // No more path, stop
        vehicle.acceleration = -BRAKE_RATE;
        vehicle.steering = 0;
        return;
    }
    
    // Step 3: Compute steering using pure-pursuit
    const rawSteering = computePurePursuitSteering(lookaheadPoint);
    
    // Smooth steering (damping)
    // When oscillation damping is active, temporarily increase smoothing too
    const damping = autopilot.dampingFactor ?? 1.0;
    const smoothingBoost = (1.0 - damping) * (autopilot.dampingSmoothingBoost ?? 0.0);
    const effectiveSteeringSmoothing = Math.min(0.45, autopilot.steeringSmoothingFactor + smoothingBoost);
    vehicle.steering = THREE.MathUtils.lerp(
        autopilot.prevSteering,
        rawSteering,
        effectiveSteeringSmoothing
    );
    autopilot.prevSteering = vehicle.steering;
    
    // Step 4: Detect upcoming curvature
    const curvature = computePathCurvature();
    
    // Step 5: Calculate target speed based on curvature
    const baseTargetSpeed = speedFromCurvature(curvature);
    
    // Step 5b: Traffic light compliance (only modifies target speed; steering unchanged)
    const targetSpeed = applyTrafficLightCompliance(baseTargetSpeed);
    
    // Smooth speed adjustment
    autopilot.currentSpeed = THREE.MathUtils.lerp(
        autopilot.currentSpeed,
        targetSpeed,
        autopilot.speedResponseRate
    );
    
    // Step 6: Apply proportional throttle/brake to reach target speed
    const speedError = autopilot.currentSpeed - vehicle.velocity;
    const speedErrorMagnitude = Math.abs(speedError);
    
    // Proportional control with aggressive braking for overshoots
    if (speedError > 0.2) {
        // Need to speed up - proportional acceleration
        const accelerationFactor = Math.min(1.0, speedErrorMagnitude / 8.0);
        vehicle.acceleration = ACCELERATION_RATE * accelerationFactor;
    } else if (speedError < -0.2) {
        // Need to slow down - proportional and aggressive braking
        // More aggressive braking when overspeeding (harder to slow down)
        const brakeFactor = Math.min(1.0, speedErrorMagnitude / 10.0);
        // Use 1.2x brake rate when overspeeding for more aggressive deceleration
        const brakeMultiplier = speedErrorMagnitude > 3.0 ? 1.2 : 0.8; // Aggressive for large errors
        vehicle.acceleration = -BRAKE_RATE * brakeMultiplier * (0.6 + 0.4 * brakeFactor);
    } else {
        // Maintain speed (tight deadband: ±0.2 m/s)
        vehicle.acceleration = 0;
    }
    
    // Validation: ensure steering is finite
    if (!isFinite(vehicle.steering)) {
        vehicle.steering = 0;
    }
}

function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    let deltaTime = (currentTime - lastTime) / 1000;
    
    // Validate and clamp deltaTime (prevent huge jumps from tab inactivity)
    if (!isFinite(deltaTime) || deltaTime <= 0 || deltaTime > 0.1) {
        // If deltaTime is invalid or too large, use a safe default (60 FPS)
        deltaTime = 0.016;
    }
    
    lastTime = currentTime;

    // Update autopilot if enabled (before physics)
    if (autopilot.enabled) {
        updateAutopilot(deltaTime);
    }
    
    // Update physics (car still moves if it was moving when admin mode activated)
    updatePhysics(deltaTime);

    // Update visuals
    updateVehicleVisuals();

    // Update camera (handles both normal and admin modes)
    if (adminCamera.enabled) {
        updateAdminCamera(deltaTime);
    } else {
        updateCamera();
    }

    // Update waypoint marker visual
    if (autopilot.enabled) {
        updateWaypointMarker();
    }

    // Update traffic light compliance debug visuals
    if (autopilot.enabled) {
        updateTrafficLightDebugVisuals();
        updateScoringDebugVisuals();
    }

    // Update UI
    updateUI();
    
    // Animate spawn marker (pulsing effect)
    if (spawnMarker && spawnMarker.userData) {
        spawnMarker.userData.originalScale += spawnMarker.userData.pulseSpeed;
        if (spawnMarker.userData.originalScale > 1.2 || spawnMarker.userData.originalScale < 1.0) {
            spawnMarker.userData.pulseSpeed *= -1;
        }
        const scale = 1.0 + 0.2 * Math.sin(spawnMarker.userData.originalScale);
        spawnMarker.scale.set(scale, scale, scale);
    }
    
    // Update sky animation
    if (skyMaterial) {
        skyMaterial.uniforms.uTime.value = performance.now() * 0.001;
    }
    
    // Make sky follow camera position (important for visibility)
    if (skyMesh) {
        skyMesh.position.copy(camera.position);
    }
    
    // Make starfield follow camera
    if (starfield) {
        starfield.position.copy(camera.position);
        starfield.rotation.y += 0.0001;
        starfield.rotation.x += 0.00005;
    }
    
    // Rotate nebula clouds slowly and make them follow camera
    nebulaClouds.forEach((cloud, i) => {
        if (cloud.userData.relativePos) {
            cloud.position.copy(camera.position).add(cloud.userData.relativePos);
        }
        cloud.rotation.z += 0.00005 * (i + 1);
    });
    
    // Make glow spots follow camera
    glowSpots.forEach(glow => {
        if (glow.userData.relativePos) {
            glow.position.copy(camera.position).add(glow.userData.relativePos);
        }
    });

    // Update traffic lights
    updateTrafficLights(deltaTime);

    // Render
    renderer.render(scene, camera);
}

// Load and render map data
async function loadMapData() {
    const statusEl = document.getElementById('mapStatus');
    try {
        statusEl.textContent = "Loading Fremont map...";
        console.log("Loading map data...");
        const response = await fetch('/api/map_data');
        if (!response.ok) {
            throw new Error('Failed to load map data');
        }
        
        mapData = await response.json();
        console.log(`Loaded ${mapData.roads.length} road segments and ${mapData.buildings.length} buildings`);
        
        statusEl.textContent = "Rendering roads...";
        // Render roads
        renderRoads(mapData.roads);
        
        statusEl.textContent = "Rendering buildings...";
        // Render buildings
        renderBuildings(mapData.buildings);
        
        // Traffic lights initialization
        statusEl.textContent = "Initializing traffic lights...";
        initializeTrafficLights(mapData.roads, mapData.buildings);
        
        // Debug: optionally show node markers (comment out for production)
        // renderDebugNodeMarkers(mapData.roads);

        // Center vehicle at map center (0, 0 after transformation)
        vehicle.x = 0;
        vehicle.z = 0;
        carGroup.position.set(0, 0, 0);
        
        statusEl.textContent = `✅ Map loaded: ${mapData.roads.length} roads, ${mapData.buildings.length} buildings`;
        statusEl.style.color = "#4caf50";
        
        console.log("Map data loaded and rendered");
        
        // Check for route in localStorage and start autopilot if available
        checkAndLoadRoute();
    } catch (error) {
        console.error("Error loading map data:", error);
        statusEl.textContent = "⚠️ Map loading failed - simulator running without map";
        statusEl.style.color = "#ff4444";
        // Continue without map data
    }
}

// Convert lat/lon to simulator coordinates (meters)
function latlonToSimulatorCoords(lat, lon, centerLat, centerLon) {
    // Validate inputs
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(centerLat) || !isFinite(centerLon)) {
        console.error('Invalid coordinates in latlonToSimulatorCoords:', { lat, lon, centerLat, centerLon });
        return { x: 0, z: 0 };
    }
    
    // Earth radius in meters
    const R = 6371000;
    
    // Convert to radians
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const centerLatRad = centerLat * Math.PI / 180;
    const centerLonRad = centerLon * Math.PI / 180;
    
    // Calculate offsets in meters (x = east, z = north)
    // Note: X is negated to fix left-right mirror inversion
    // This ensures the simulator matches real-world orientation
    const x = -R * (lonRad - centerLonRad) * Math.abs(Math.cos(centerLatRad));
    const z = R * (latRad - centerLatRad);
    
    // Validate outputs
    if (!isFinite(x) || !isFinite(z)) {
        console.error('Invalid coordinate transformation result:', { x, z });
        return { x: 0, z: 0 };
    }
    
    return { x, z };
}

// Check localStorage for route and initialize autopilot
function checkAndLoadRoute() {
    try {
        const routeDataStr = localStorage.getItem('autopilot_route');
        if (!routeDataStr) {
            console.log("No route data found in localStorage");
            return;
        }
        
        const routeData = JSON.parse(routeDataStr);
        if (!routeData.waypoints || routeData.waypoints.length < 2) {
            console.warn("Invalid route data: insufficient waypoints");
            return;
        }
        
        console.log("Route data found:", routeData);
        
        // Get map center from map data
        if (!mapData || !mapData.center) {
            console.error("Map data not loaded yet or missing center");
            return;
        }
        
        const [centerLat, centerLon] = mapData.center;
        
        // Convert waypoints from lat/lon to simulator coordinates (with validation)
        const simulatorWaypoints = routeData.waypoints
            .map(wp => {
                if (!wp || !isFinite(wp.lat) || !isFinite(wp.lon)) {
                    console.warn('Invalid waypoint in route data:', wp);
                    return null;
                }
                const coords = latlonToSimulatorCoords(wp.lat, wp.lon, centerLat, centerLon);
                if (!isFinite(coords.x) || !isFinite(coords.z)) {
                    console.warn('Invalid coordinate transformation for waypoint:', wp);
                    return null;
                }
                return { x: coords.x, z: coords.z };
            })
            .filter(wp => wp !== null); // Remove invalid waypoints
        
        if (simulatorWaypoints.length < 2) {
            console.error('Insufficient valid waypoints after conversion:', simulatorWaypoints.length);
            return;
        }
        
        // Initialize autopilot
        autopilot.waypoints = simulatorWaypoints;
        autopilot.currentWaypointIndex = 0;
        autopilot.lastWaypointDistance = Infinity;
        autopilot.enabled = true;
        
        // Spawn car at first waypoint with correct orientation
        spawnCarAtWaypoint(0);
        
        // Render debug visuals
        renderRouteDebugVisuals();
        
        // Update status
        const statusEl = document.getElementById('mapStatus');
        statusEl.textContent = `✅ Map loaded | 🚗 Autopilot: ${routeData.waypoints.length} waypoints`;
        statusEl.style.color = "#4caf50";
        
        // Clear localStorage after loading (optional - for testing, you might want to keep it)
        // localStorage.removeItem('autopilot_route');
        
    } catch (error) {
        console.error("Error loading route:", error);
    }
}

// Spawn car at waypoint index with orientation toward next waypoint
function spawnCarAtWaypoint(waypointIndex) {
    if (waypointIndex >= autopilot.waypoints.length) {
        console.error("Waypoint index out of range");
        return;
    }
    
    const wp = autopilot.waypoints[waypointIndex];
    
    // Validate waypoint coordinates
    if (!wp || !isFinite(wp.x) || !isFinite(wp.z)) {
        console.error(`Invalid waypoint at index ${waypointIndex}:`, wp);
        return;
    }
    
    // Calculate orientation (angle) toward next waypoint
    let angle = 0;
    if (waypointIndex < autopilot.waypoints.length - 1) {
        const nextWp = autopilot.waypoints[waypointIndex + 1];
        if (nextWp && isFinite(nextWp.x) && isFinite(nextWp.z)) {
            const dx = nextWp.x - wp.x;
            const dz = nextWp.z - wp.z;
            // In our coordinate system: angle=0 means pointing along negative Z axis
            // atan2(dx, -dz) gives us the correct angle
            angle = Math.atan2(dx, -dz);
            if (!isFinite(angle)) {
                console.warn('Invalid angle calculation, using 0');
                angle = 0;
            }
        }
    }
    
    // Set vehicle position and orientation
    vehicle.x = wp.x;
    vehicle.z = wp.z;
    vehicle.angle = angle;
    
    // Validate after setting
    validateVehicleState();
    vehicle.velocity = 0;
    vehicle.steering = 0;
    vehicle.steeringActual = 0;
    vehicle.angularVelocity = 0;
    vehicle.tilt = 0;
    vehicle.tiltTarget = 0;
    
    // Update car visual position
    carGroup.position.set(vehicle.x, 0, vehicle.z);
    carGroup.rotation.y = -vehicle.angle;
    carGroup.rotation.z = 0;
    
    console.log(`Car spawned at waypoint ${waypointIndex}: (${wp.x.toFixed(2)}, ${wp.z.toFixed(2)}) angle=${(angle * 180 / Math.PI).toFixed(1)}°`);
}
/*
// Render roads as continuous ribbons (properly scaled width, fully connected)
function renderRoads(roads) {
    const roadGroup = new THREE.Group();
    
    // Different colors and widths (in meters) for different road types
    const roadTypeStyles = {
        'motorway': { color: 0x2a2a2a, width: 12 },      // ~12m wide (highway lanes)
        'trunk': { color: 0x333333, width: 10 },         // ~10m wide
        'primary': { color: 0x444444, width: 8 },        // ~8m wide (main roads)
        'secondary': { color: 0x555555, width: 7 },      // ~7m wide
        'tertiary': { color: 0x666666, width: 6 },       // ~6m wide
        'residential': { color: 0x777777, width: 5 },    // ~5m wide (residential)
        'unclassified': { color: 0x888888, width: 5 },   // ~5m wide
        'service': { color: 0x999999, width: 4 },        // ~4m wide (alleys/driveways)
        'living_street': { color: 0x777777, width: 5 }   // ~5m wide
    };
    
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let totalSegments = 0;
    
    // Render each road as a continuous path with properly aligned segments
    roads.forEach(road => {
        if (road.coordinates.length < 2) return;
        
        const style = roadTypeStyles[road.type] || { color: 0x666666, width: 5 };
        const roadWidth = style.width;
        const color = style.color;
        
        // Create continuous road segments with proper overlap
        for (let i = 0; i < road.coordinates.length - 1; i++) {
            const start = road.coordinates[i];
            const end = road.coordinates[i + 1];
            
            const x1 = start[0];
            const z1 = start[1];
            const x2 = end[0];
            const z2 = end[1];
            
            // Track bounds
            minX = Math.min(minX, x1, x2);
            maxX = Math.max(maxX, x1, x2);
            minZ = Math.min(minZ, z1, z2);
            maxZ = Math.max(maxZ, z1, z2);
            
            // Calculate segment length and direction (in XZ plane)
            const dx = x2 - x1;
            const dz = z2 - z1;
            const length = Math.sqrt(dx * dx + dz * dz);
            
            // Skip zero-length segments
            if (length < 0.01) continue;
            
            const angle = Math.atan2(dz, dx);
            
            // Create box geometry: length along X-axis, height along Y, width along Z
            // We'll rotate it to align with the road direction
            const geometry = new THREE.BoxGeometry(length, 0.1, roadWidth);
            const material = new THREE.MeshLambertMaterial({ 
                color: color,
                side: THREE.DoubleSide
            });
            
            const segment = new THREE.Mesh(geometry, material);
            
            // Position at midpoint
            const midX = (x1 + x2) / 2;
            const midZ = (z1 + z2) / 2;
            segment.position.set(midX, 0.05, midZ); // Slightly above ground
            
            // Rotate around Y-axis to align with road direction
            // BoxGeometry extends along X-axis by default, so we rotate to match the road angle
            segment.rotation.y = angle;
            
            segment.receiveShadow = true;
            segment.castShadow = false;
            
            roadGroup.add(segment);
            totalSegments++;
        }
    });
    
    scene.add(roadGroup);
    
    // Resize ground to fit map
    if (minX !== Infinity && maxX !== -Infinity) {
        const mapSize = Math.max(maxX - minX, maxZ - minZ) * 1.2;
        createGround(mapSize);
    }
    
    console.log(`Rendered ${roads.length} roads with ${totalSegments} continuous segments`);
    if (minX !== Infinity) {
        console.log(`Map bounds: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}], Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
    }
}
*/

// Ultra-optimized: Batch roads by type into single meshes with PBR materials

function renderRoads(roads) {
    // Road type styles - unified color, different widths only
    const roadTypeStyles = {
        'motorway': { width: 12 },
        'trunk': { width: 10 },
        'primary': { width: 8 },
        'secondary': { width: 7 },
        'tertiary': { width: 6 },
        'residential': { width: 5 },
        'unclassified': { width: 5 },
        'service': { width: 4 },
        'living_street': { width: 5 }
    };
    
    // Group roads by type for batching
    const roadsByType = {};
    
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    
    roads.forEach(road => {
        if (road.coordinates.length < 2) return;
        
        const roadType = road.type || 'unclassified';
        if (!roadsByType[roadType]) {
            roadsByType[roadType] = [];
        }
        roadsByType[roadType].push(road);
    });
    
    // Create unified PBR asphalt material (shared across all roads)
    const roadMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x2b2b2b), // Dark asphalt gray
        roughness: 0.85,                   // High roughness = matte surface
        metalness: 0.0,                    // Asphalt is non-metallic
        fog: true,                         // Roads fade into fog naturally
        side: THREE.DoubleSide
    });
    
    // Create one mesh per road type (much fewer draw calls)
    Object.keys(roadsByType).forEach(roadType => {
        const style = roadTypeStyles[roadType] || { width: 5 };
        const roadWidth = style.width;
        const roadsOfType = roadsByType[roadType];
        
        const vertices = [];
        const indices = [];
        let vertexOffset = 0;
        
        roadsOfType.forEach(road => {
            const roadVertices = [];
            
            for (let i = 0; i < road.coordinates.length; i++) {
                const x = road.coordinates[i][0];
                const z = road.coordinates[i][1];
                
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);
                
                // Calculate perpendicular direction
                let perpX = 0, perpZ = 0;
                
                if (i === 0 && road.coordinates.length > 1) {
                    const dx = road.coordinates[i + 1][0] - x;
                    const dz = road.coordinates[i + 1][1] - z;
                    const len = Math.sqrt(dx * dx + dz * dz);
                    if (len > 0.001) {
                        perpX = -dz / len;
                        perpZ = dx / len;
                    }
                } else if (i === road.coordinates.length - 1) {
                    const dx = x - road.coordinates[i - 1][0];
                    const dz = z - road.coordinates[i - 1][1];
                    const len = Math.sqrt(dx * dx + dz * dz);
                    if (len > 0.001) {
                        perpX = -dz / len;
                        perpZ = dx / len;
                    }
                } else {
                    const dx1 = x - road.coordinates[i - 1][0];
                    const dz1 = z - road.coordinates[i - 1][1];
                    const len1 = Math.sqrt(dx1 * dx1 + dz1 * dz1);
                    
                    const dx2 = road.coordinates[i + 1][0] - x;
                    const dz2 = road.coordinates[i + 1][1] - z;
                    const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
                    
                    if (len1 > 0.001 && len2 > 0.001) {
                        const perp1X = -dz1 / len1;
                        const perp1Z = dx1 / len1;
                        const perp2X = -dz2 / len2;
                        const perp2Z = dx2 / len2;
                        
                        perpX = (perp1X + perp2X) / 2;
                        perpZ = (perp1Z + perp2Z) / 2;
                        
                        const perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
                        if (perpLen > 0.001) {
                            perpX /= perpLen;
                            perpZ /= perpLen;
                        }
                    }
                }
                
                const halfWidth = roadWidth / 2;
                roadVertices.push(
                    x + perpX * halfWidth, 0.05, z + perpZ * halfWidth,
                    x - perpX * halfWidth, 0.05, z - perpZ * halfWidth
                );
                
                if (i < road.coordinates.length - 1) {
                    const baseIdx = vertexOffset + i * 2;
                    indices.push(
                        baseIdx, baseIdx + 1, baseIdx + 2,
                        baseIdx + 1, baseIdx + 3, baseIdx + 2
                    );
                }
            }
            
            vertices.push(...roadVertices);
            vertexOffset += road.coordinates.length * 2;
        });
        
        // Create single mesh for all roads of this type
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        const roadMesh = new THREE.Mesh(geometry, roadMaterial);
        roadMesh.receiveShadow = true;
        roadMesh.castShadow = false;
        
        scene.add(roadMesh);
        
        console.log(`Rendered ${roadsOfType.length} ${roadType} roads in single mesh`);
    });
    
    // Resize ground to fit map
    if (minX !== Infinity && maxX !== -Infinity) {
        const mapSize = Math.max(maxX - minX, maxZ - minZ) * 1.2;
        createGround(mapSize);
    }
    
    console.log(`Total: ${roads.length} roads rendered in ${Object.keys(roadsByType).length} batched meshes`);
    console.log(`✅ Using unified PBR asphalt material (color: 0x2b2b2b, roughness: 0.85, metalness: 0.0)`);
    if (minX !== Infinity) {
        console.log(`Map bounds: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}], Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
    }
}


// ============================================================================
// TRAFFIC LIGHT SYSTEM - Directional Traffic Light System
// ============================================================================

/**
 * Check if a road type is considered "major" (signalized intersections)
 */
function isMajorRoad(roadType) {
    const majorTypes = ['motorway', 'trunk', 'primary', 'secondary'];
    return majorTypes.includes(roadType);
}

/**
 * Get road width from road type
 */
function getRoadWidth(roadType) {
    return ROAD_TYPE_WIDTHS[roadType] || 5;
}

/**
 * Calculate average building height within radius of a point
 */
function getAverageBuildingHeight(buildings, centerX, centerZ, radius = 50) {
    if (!buildings || buildings.length === 0) return 8; // Default height
    
    let totalHeight = 0;
    let count = 0;
    
    buildings.forEach(building => {
        if (building.coordinates.length < 3) return;
        
        // Calculate building centroid
        let centroidX = 0, centroidZ = 0;
        for (const coord of building.coordinates) {
            centroidX += coord[0];
            centroidZ += coord[1];
        }
        centroidX /= building.coordinates.length;
        centroidZ /= building.coordinates.length;
        
        // Check if within radius
        const dx = centroidX - centerX;
        const dz = centroidZ - centerZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= radius) {
            // Use same height calculation as renderBuildings (deterministic based on index)
            const baseHeight = 5;
            const heightVariation = (building.coordinates.length % 15) * 1.0; // Deterministic variation
            const floors = Math.floor((baseHeight + heightVariation) / 3);
            const buildingHeight = floors * 3;
            
            totalHeight += buildingHeight;
            count++;
        }
    });
    
    return count > 0 ? totalHeight / count : 8; // Default if no buildings nearby
}

/**
 * Find intersections by analyzing road coordinates
 * Returns array of intersections with approach analysis
 */
function findIntersections(roads) {
    const nodeMap = new Map(); // Map coordinate key to array of roads
    
    // Build map of coordinates to roads
    roads.forEach((road, roadIdx) => {
        road.coordinates.forEach((coord, coordIdx) => {
            const key = `${Math.round(coord[0] / INTERSECTION_THRESHOLD)},${Math.round(coord[1] / INTERSECTION_THRESHOLD)}`;
            if (!nodeMap.has(key)) {
                nodeMap.set(key, []);
            }
            nodeMap.get(key).push({ road, coord, roadIdx, coordIdx });
        });
    });
    
    // Find intersections (nodes with ≥3 connections)
    const intersections = [];
    nodeMap.forEach((roadsAtNode, key) => {
        // Count unique roads (not just coordinate occurrences)
        const uniqueRoads = new Set();
        roadsAtNode.forEach(item => uniqueRoads.add(item.roadIdx));
        
        if (uniqueRoads.size >= 3) {
            // Check if at least one road is major
            const hasMajorRoad = roadsAtNode.some(item => isMajorRoad(item.road.type));
            
            if (hasMajorRoad) {
                // Calculate average position (handle multiple coordinates at same intersection)
                let sumX = 0, sumZ = 0, count = 0;
                roadsAtNode.forEach(item => {
                    sumX += item.coord[0];
                    sumZ += item.coord[1];
                    count++;
                });
                
                const intersectionPos = { x: sumX / count, z: sumZ / count };
                
                // Analyze approaches for each connected road
                const approaches = [];
                const processedRoads = new Set();
                
                roadsAtNode.forEach(item => {
                    if (processedRoads.has(item.roadIdx)) return;
                    processedRoads.add(item.roadIdx);
                    
                    const road = item.road;
                    const coordIdx = item.coordIdx;
                    const coord = item.coord;
                    
                    // Determine approach direction (from road toward intersection)
                    let approachDir = null;
                    
                    if (coordIdx === 0) {
                        // Road starts at intersection, approach is from the end
                        if (road.coordinates.length > 1) {
                            const endCoord = road.coordinates[road.coordinates.length - 1];
                            const dx = coord[0] - endCoord[0];
                            const dz = coord[1] - endCoord[1];
                            const len = Math.sqrt(dx * dx + dz * dz);
                            if (len > 0.1) {
                                approachDir = new THREE.Vector3(dx / len, 0, dz / len);
                            }
                        }
                    } else if (coordIdx === road.coordinates.length - 1) {
                        // Road ends at intersection, approach is from the start
                        if (road.coordinates.length > 1) {
                            const startCoord = road.coordinates[0];
                            const dx = coord[0] - startCoord[0];
                            const dz = coord[1] - startCoord[1];
                            const len = Math.sqrt(dx * dx + dz * dz);
                            if (len > 0.1) {
                                approachDir = new THREE.Vector3(dx / len, 0, dz / len);
                            }
                        }
                    } else {
                        // Road passes through intersection (middle point)
                        // Use direction from previous point toward intersection
                        const prevCoord = road.coordinates[coordIdx - 1];
                        const dx = coord[0] - prevCoord[0];
                        const dz = coord[1] - prevCoord[1];
                        const len = Math.sqrt(dx * dx + dz * dz);
                        if (len > 0.1) {
                            approachDir = new THREE.Vector3(dx / len, 0, dz / len);
                        }
                    }
                    
                    if (approachDir) {
                        // Calculate right-hand perpendicular using cross product
                        const up = new THREE.Vector3(0, 1, 0);
                        const rightPerp = new THREE.Vector3();
                        rightPerp.crossVectors(approachDir, up).normalize();
                        
                        // Get road width
                        const roadWidth = getRoadWidth(road.type);
                        
                        // Check for left-turn possibility
                        // Find other roads at this intersection that could be left-turn targets
                        let hasLeftTurn = false;
                        roadsAtNode.forEach(otherItem => {
                            if (otherItem.roadIdx === item.roadIdx) return;
                            
                            const otherRoad = otherItem.road;
                            const otherCoord = otherItem.coord;
                            
                            // Calculate direction from intersection to other road
                            const dx = otherCoord[0] - coord[0];
                            const dz = otherCoord[1] - coord[1];
                            const len = Math.sqrt(dx * dx + dz * dz);
                            if (len > 0.1) {
                                const exitDir = new THREE.Vector3(dx / len, 0, dz / len);
                                
                                // Calculate angle between approach and exit
                                const angle = Math.acos(Math.max(-1, Math.min(1, approachDir.dot(exitDir))));
                                
                                // Check if it's a left turn (angle > 45° and < 135°, and exit is to the left)
                                const crossZ = approachDir.x * exitDir.z - approachDir.z * exitDir.x;
                                if (angle > Math.PI / 4 && angle < 3 * Math.PI / 4 && crossZ > 0) {
                                    hasLeftTurn = true;
                                }
                            }
                        });
                        
                        approaches.push({
                            road,
                            roadIdx: item.roadIdx,
                            approachDirection: approachDir,
                            rightPerpendicular: rightPerp,
                            roadWidth,
                            hasLeftTurn
                        });
                    }
                });
                
                if (approaches.length > 0) {
                    intersections.push({
                        position: intersectionPos,
                        connectedRoads: Array.from(uniqueRoads).map(idx => roads[idx]),
                        approaches
                    });
                }
            }
        }
    });
    
    return intersections;
}

/**
 * Create a traffic light mesh with proper scaling and optional left-turn arrow
 * @param {number} poleHeight - Height of the pole (scaled based on buildings)
 * @param {boolean} hasLeftTurn - Whether to include left-turn arrow signal
 * @returns {Object} Traffic light mesh components
 */
function createTrafficLightMesh(poleHeight, hasLeftTurn = false) {
    const group = new THREE.Group();
    
    // Scale factors based on pole height (proportional scaling)
    const baseHeight = 8; // Base reference height
    const scaleFactor = poleHeight / baseHeight;
    
    // Pole dimensions (scaled)
    const poleRadius = 0.15 * scaleFactor; // Proportional to height
    const poleGeometry = new THREE.CylinderGeometry(poleRadius, poleRadius, poleHeight, 16);
    const poleMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x333333,
        roughness: 0.7,
        metalness: 0.3
    });
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = poleHeight / 2;
    pole.castShadow = true;
    pole.receiveShadow = true;
    group.add(pole);
    
    // Horizontal arm extending over the road
    const armLength = 3.0 * scaleFactor;
    const armRadius = 0.12 * scaleFactor;
    const armGeometry = new THREE.CylinderGeometry(armRadius, armRadius, armLength, 16);
    const armMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x333333,
        roughness: 0.7,
        metalness: 0.3
    });
    const arm = new THREE.Mesh(armGeometry, armMaterial);
    arm.rotation.z = Math.PI / 2;
    arm.position.y = poleHeight - 0.5 * scaleFactor;
    arm.position.x = armLength / 2;
    arm.castShadow = true;
    group.add(arm);
    
    // Signal box dimensions (scaled)
    const boxWidth = 3*0.5 * scaleFactor;
    const boxHeight = 3*1.2 * scaleFactor;
    const boxDepth = 3*0.2 * scaleFactor;
    const boxGeometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
    const boxMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a,
        roughness: 0.8,
        metalness: 0.1
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.x = armLength;
    box.position.y = poleHeight - 0.5 * scaleFactor - (boxHeight / 2);
    box.castShadow = true;
    group.add(box);
    
    // Light dimensions (scaled)
    const lightRadius = 3*0.15 * scaleFactor;
    const lightGeometry = new THREE.SphereGeometry(lightRadius, 16, 16);
    const lightSpacing = 3*0.35 * scaleFactor;
    
    // Straight signal lights (R/Y/G) - vertical stack
    const redMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xff0000,
        emissive: 0x000000,
        emissiveIntensity: 0.0
    });
    const redLight = new THREE.Mesh(lightGeometry, redMaterial);
    redLight.position.set(armLength, poleHeight - 0.5 * scaleFactor - (boxHeight / 2) + lightSpacing, boxDepth / 2 + 0.01);
    group.add(redLight);
    
    const yellowMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffff00,
        emissive: 0x000000,
        emissiveIntensity: 0.0
    });
    const yellowLight = new THREE.Mesh(lightGeometry, yellowMaterial);
    yellowLight.position.set(armLength, poleHeight - 0.5 * scaleFactor - (boxHeight / 2), boxDepth / 2 + 0.01);
    group.add(yellowLight);
    
    const greenMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00ff00,
        emissive: 0x000000,
        emissiveIntensity: 0.0
    });
    const greenLight = new THREE.Mesh(lightGeometry, greenMaterial);
    greenLight.position.set(armLength, poleHeight - 0.5 * scaleFactor - (boxHeight / 2) - lightSpacing, boxDepth / 2 + 0.01);
    group.add(greenLight);
    
    // Left-turn arrow signal (if needed) - positioned to the left of straight signals
    let leftRedMaterial = null;
    let leftGreenMaterial = null;
    let leftRedLight = null;
    let leftGreenLight = null;
    
    if (hasLeftTurn) {
        // Left-turn box (smaller, offset to the left)
        const leftBoxWidth = 0.4 * scaleFactor;
        const leftBoxHeight = 0.8 * scaleFactor;
        const leftBoxDepth = 0.2 * scaleFactor;
        const leftBoxGeometry = new THREE.BoxGeometry(leftBoxWidth, leftBoxHeight, leftBoxDepth);
        const leftBox = new THREE.Mesh(leftBoxGeometry, boxMaterial);
        leftBox.position.x = armLength - 0.3 * scaleFactor; // Offset left
        leftBox.position.y = poleHeight - 0.5 * scaleFactor - (leftBoxHeight / 2);
        leftBox.castShadow = true;
        group.add(leftBox);
        
        // Left-turn arrow lights (red and green only, no yellow)
        const arrowLightRadius = 0.12 * scaleFactor;
        const arrowLightGeometry = new THREE.SphereGeometry(arrowLightRadius, 16, 16);
        const arrowSpacing = 0.25 * scaleFactor;
        
        leftRedMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xff0000,
            emissive: 0x000000,
            emissiveIntensity: 0.0
        });
        leftRedLight = new THREE.Mesh(arrowLightGeometry, leftRedMaterial);
        leftRedLight.position.set(armLength - 0.3 * scaleFactor, poleHeight - 0.5 * scaleFactor - (leftBoxHeight / 2) + arrowSpacing, leftBoxDepth / 2 + 0.01);
        group.add(leftRedLight);
        
        leftGreenMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x00ff00,
            emissive: 0x000000,
            emissiveIntensity: 0.0
        });
        leftGreenLight = new THREE.Mesh(arrowLightGeometry, leftGreenMaterial);
        leftGreenLight.position.set(armLength - 0.3 * scaleFactor, poleHeight - 0.5 * scaleFactor - (leftBoxHeight / 2) - arrowSpacing, leftBoxDepth / 2 + 0.01);
        group.add(leftGreenLight);
        
        // Create arrow shape indicator (simple triangle for visual clarity)
        const arrowShape = new THREE.Shape();
        arrowShape.moveTo(0, 0);
        arrowShape.lineTo(-0.1 * scaleFactor, -0.15 * scaleFactor);
        arrowShape.lineTo(0.1 * scaleFactor, -0.15 * scaleFactor);
        arrowShape.lineTo(0, 0);
        const arrowGeometry = new THREE.ShapeGeometry(arrowShape);
        const arrowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            transparent: true,
            opacity: 0.3
        });
        const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
        arrowMesh.position.set(armLength - 0.3 * scaleFactor, poleHeight - 0.5 * scaleFactor - (leftBoxHeight / 2) - arrowSpacing, leftBoxDepth / 2 + 0.02);
        arrowMesh.rotation.z = Math.PI / 2; // Rotate to point left
        group.add(arrowMesh);
    }
    
    return {
        group,
        redLight,
        yellowLight,
        greenLight,
        leftRedLight,
        leftGreenLight,
        redMaterial,
        yellowMaterial,
        greenMaterial,
        leftRedMaterial,
        leftGreenMaterial
    };
}


/**
 * Create traffic lights at an intersection for all approaches
 * @param {Object} intersection - Intersection with approaches analyzed
 * @param {number} poleHeight - Height of traffic light poles (scaled from buildings)
 */
function createTrafficLightsAtIntersection(intersection, poleHeight) {
    const lights = [];
    const lightGroup = new THREE.Group();
    
    // Group approaches by primary direction (NS vs EW) for signal phasing
    const nsApproaches = [];
    const ewApproaches = [];
    
    intersection.approaches.forEach(approach => {
        const approachDir = approach.approachDirection;
        // Classify as NS (primarily Z-axis) or EW (primarily X-axis)
        if (Math.abs(approachDir.z) > Math.abs(approachDir.x)) {
            nsApproaches.push(approach);
        } else {
            ewApproaches.push(approach);
        }
    });
    
    // Create traffic light for each approach
    intersection.approaches.forEach(approach => {
        const approachDir = approach.approachDirection;
        const rightPerp = approach.rightPerpendicular;
        const roadWidth = approach.roadWidth;
        const hasLeftTurn = approach.hasLeftTurn;
        
        // Position calculation: intersectionPos - approachDir * stopDistance + rightPerp * roadWidth/2
        const stopDistance = 8.0; // 6-10 meters before intersection
        
        const lightPos = new THREE.Vector3(
            intersection.position.x,
            0,
            intersection.position.z
        );
        
        // Move back along approach direction (away from intersection)
        lightPos.sub(approachDir.clone().multiplyScalar(stopDistance));
        
        // Offset to right-hand side of road
        lightPos.add(rightPerp.clone().multiplyScalar(roadWidth / 2 + 0.5)); // Slightly outside road edge
        
        // Create traffic light mesh with proper height and left-turn support
        const lightMesh = createTrafficLightMesh(poleHeight, hasLeftTurn);
        lightMesh.group.position.copy(lightPos);
        
        // Rotate to face incoming traffic
        // Rotation: atan2(approachDir.x, approachDir.z) + π to face toward intersection
        const angle = Math.atan2(approachDir.x, approachDir.z) + Math.PI;
        lightMesh.group.rotation.y = angle;
        
        lightGroup.add(lightMesh.group);
        
        // Determine which signal group this approach belongs to
        const isNS = Math.abs(approachDir.z) > Math.abs(approachDir.x);
        
        // Store light state
        lights.push({
            mesh: lightMesh,
            approach: approach,
            isNS: isNS,
            type: 'straight', // Will be updated during phasing
            phase: 'RED', // Start red, will be controlled by signal state
            timer: 0
        });
        
        // If has left turn, also create a left-turn light entry
        if (hasLeftTurn) {
            lights.push({
                mesh: lightMesh, // Same mesh, different signal
                approach: approach,
                isNS: isNS,
                type: 'left',
                phase: 'RED',
                timer: 0
            });
        }
    });
    
    scene.add(lightGroup);
    
    // Initialize signal state machine
    // States: 'NS_STRAIGHT', 'NS_LEFT', 'YELLOW_NS', 'EW_STRAIGHT', 'EW_LEFT', 'YELLOW_EW'
    const signalState = {
        currentPhase: 'NS_STRAIGHT',
        timer: 0,
        lastGreenDirection: 'NS' // Track which direction was green for yellow phase
    };
    
    return {
        intersection,
        lights,
        group: lightGroup,
        signalState,
        nsApproaches,
        ewApproaches
    };
}

/**
 * Update traffic light phases and visual states using intersection state machine
 */
function updateTrafficLights(deltaTime) {
    trafficLights.forEach(trafficLight => {
        const signalState = trafficLight.signalState;
        signalState.timer += deltaTime;
        
        // State machine transitions
        let phaseDuration = 0;
        let nextPhase = null;
        
        switch (signalState.currentPhase) {
            case 'NS_STRAIGHT':
                phaseDuration = TRAFFIC_LIGHT_TIMINGS.STRAIGHT_GREEN;
                if (signalState.timer >= phaseDuration) {
                    // Check if NS has left turns, otherwise skip to yellow
                    if (trafficLight.nsApproaches.some(a => a.hasLeftTurn)) {
                        nextPhase = 'NS_LEFT';
                    } else {
                        signalState.lastGreenDirection = 'NS';
                        nextPhase = 'YELLOW_NS';
                    }
                }
                break;
            case 'NS_LEFT':
                phaseDuration = TRAFFIC_LIGHT_TIMINGS.LEFT_GREEN;
                if (signalState.timer >= phaseDuration) {
                    signalState.lastGreenDirection = 'NS';
                    nextPhase = 'YELLOW_NS';
                }
                break;
            case 'YELLOW_NS':
                phaseDuration = TRAFFIC_LIGHT_TIMINGS.YELLOW;
                if (signalState.timer >= phaseDuration) {
                    // Transition to EW
                    nextPhase = 'EW_STRAIGHT';
                }
                break;
            case 'EW_STRAIGHT':
                phaseDuration = TRAFFIC_LIGHT_TIMINGS.STRAIGHT_GREEN;
                if (signalState.timer >= phaseDuration) {
                    if (trafficLight.ewApproaches.some(a => a.hasLeftTurn)) {
                        nextPhase = 'EW_LEFT';
                    } else {
                        signalState.lastGreenDirection = 'EW';
                        nextPhase = 'YELLOW_EW';
                    }
                }
                break;
            case 'EW_LEFT':
                phaseDuration = TRAFFIC_LIGHT_TIMINGS.LEFT_GREEN;
                if (signalState.timer >= phaseDuration) {
                    signalState.lastGreenDirection = 'EW';
                    nextPhase = 'YELLOW_EW';
                }
                break;
            case 'YELLOW_EW':
                phaseDuration = TRAFFIC_LIGHT_TIMINGS.YELLOW;
                if (signalState.timer >= phaseDuration) {
                    // Cycle back to NS
                    nextPhase = 'NS_STRAIGHT';
                }
                break;
        }
        
        // Handle transition
        if (nextPhase) {
            signalState.currentPhase = nextPhase;
            signalState.timer = 0;
        }
        
        // Update each light based on signal state
        const emissiveIntensity = 15.0; // Bright glow
        
        trafficLight.lights.forEach(light => {
            const mesh = light.mesh;
            const isNS = light.isNS;
            const isLeft = light.type === 'left';
            
            // Determine if this light should be active based on signal state
            let shouldBeGreen = false;
            let shouldBeYellow = false;
            
            if (signalState.currentPhase === 'YELLOW_NS' && isNS) {
                // Yellow for NS direction
                shouldBeYellow = true;
            } else if (signalState.currentPhase === 'YELLOW_EW' && !isNS) {
                // Yellow for EW direction
                shouldBeYellow = true;
            } else if (isNS) {
                // NS direction
                if (signalState.currentPhase === 'NS_STRAIGHT' && !isLeft) {
                    shouldBeGreen = true;
                } else if (signalState.currentPhase === 'NS_LEFT' && isLeft) {
                    shouldBeGreen = true;
                }
            } else {
                // EW direction
                if (signalState.currentPhase === 'EW_STRAIGHT' && !isLeft) {
                    shouldBeGreen = true;
                } else if (signalState.currentPhase === 'EW_LEFT' && isLeft) {
                    shouldBeGreen = true;
                }
            }
            
            // Update straight signal lights
            mesh.redMaterial.emissiveIntensity = (!shouldBeGreen && !shouldBeYellow) ? emissiveIntensity : 0.0;
            mesh.yellowMaterial.emissiveIntensity = shouldBeYellow ? emissiveIntensity : 0.0;
            mesh.greenMaterial.emissiveIntensity = shouldBeGreen ? emissiveIntensity : 0.0;
            
            if (mesh.redMaterial.emissiveIntensity > 0) {
                mesh.redMaterial.emissive.setHex(0xff0000);
            }
            if (mesh.yellowMaterial.emissiveIntensity > 0) {
                mesh.yellowMaterial.emissive.setHex(0xffff00);
            }
            if (mesh.greenMaterial.emissiveIntensity > 0) {
                mesh.greenMaterial.emissive.setHex(0x00ff00);
            }
            
            // Update left-turn arrow lights (if present)
            if (mesh.leftRedMaterial && mesh.leftGreenMaterial) {
                if (isLeft) {
                    mesh.leftRedMaterial.emissiveIntensity = (!shouldBeGreen) ? emissiveIntensity : 0.0;
                    mesh.leftGreenMaterial.emissiveIntensity = shouldBeGreen ? emissiveIntensity : 0.0;
                    
                    if (mesh.leftRedMaterial.emissiveIntensity > 0) {
                        mesh.leftRedMaterial.emissive.setHex(0xff0000);
                    }
                    if (mesh.leftGreenMaterial.emissiveIntensity > 0) {
                        mesh.leftGreenMaterial.emissive.setHex(0x00ff00);
                    }
                } else {
                    // Left-turn lights off for straight signals
                    mesh.leftRedMaterial.emissiveIntensity = 0.0;
                    mesh.leftGreenMaterial.emissiveIntensity = 0.0;
                }
            }
        });
    });
}

/**
 * Initialize traffic lights from map data
 * @param {Array} roads - Road segments
 * @param {Array} buildings - Building polygons for height scaling
 */
function initializeTrafficLights(roads, buildings) {
    // Clear existing traffic lights
    trafficLights.forEach(tl => {
        scene.remove(tl.group);
        tl.group.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    });
    trafficLights = [];
    
    // Find intersections with approach analysis
    const intersections = findIntersections(roads);
    console.log(`Found ${intersections.length} signalized intersections`);
    
    // Create traffic lights at each intersection
    intersections.forEach(intersection => {
        // Calculate pole height based on nearby buildings
        const avgBuildingHeight = getAverageBuildingHeight(
            buildings,
            intersection.position.x,
            intersection.position.z,
            50 // 50m radius
        );
        
        // Clamp pole height: avgBuildingHeight * 0.25, between 6 and 12 meters
        const poleHeight = Math.max(6, Math.min(12, avgBuildingHeight * 0.25));
        
        const trafficLight = createTrafficLightsAtIntersection(intersection, poleHeight);
        trafficLights.push(trafficLight);
    });
    
    console.log(`Created ${trafficLights.length} traffic light systems with ${trafficLights.reduce((sum, tl) => sum + tl.lights.length, 0)} total lights`);
}

// Debug function: Render small markers at node positions to verify connectivity
function renderDebugNodeMarkers(roads) {
    const markerGroup = new THREE.Group();
    const markerGeometry = new THREE.SphereGeometry(1, 8, 8); // 1m radius spheres
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red markers
    
    const nodeSet = new Set(); // Track unique nodes to avoid duplicates
    
    roads.forEach(road => {
        road.coordinates.forEach(coord => {
            const key = `${coord[0].toFixed(2)},${coord[1].toFixed(2)}`;
            if (!nodeSet.has(key)) {
                nodeSet.add(key);
                const marker = new THREE.Mesh(markerGeometry, markerMaterial);
                marker.position.set(coord[0], 1, coord[1]); // 1m above ground
                markerGroup.add(marker);
            }
        });
    });
    
    scene.add(markerGroup);
    console.log(`Debug: Rendered ${nodeSet.size} unique node markers`);
}

// Render buildings as extrusions
// Render buildings as extrusions with realistic PBR materials
function renderBuildings(buildings) {
    const buildingGroup = new THREE.Group();
    
    // Base building materials - neutral, realistic palette
    const buildingBaseMaterials = [
        new THREE.MeshStandardMaterial({
            color: 0xb0b0b0,      // Light gray concrete
            roughness: 0.7,
            metalness: 0.0,
            fog: true
        }),
        new THREE.MeshStandardMaterial({
            color: 0x9aa3a7,      // Cool gray stone
            roughness: 0.75,
            metalness: 0.0,
            fog: true
        }),
        new THREE.MeshStandardMaterial({
            color: 0xc2b8a3,      // Warm beige/tan
            roughness: 0.65,
            metalness: 0.0,
            fog: true
        }),
        new THREE.MeshStandardMaterial({
            color: 0xa89f91,      // Earthy brown-gray
            roughness: 0.72,
            metalness: 0.0,
            fog: true
        }),
        new THREE.MeshStandardMaterial({
            color: 0xd4cfc8,      // Off-white/cream
            roughness: 0.68,
            metalness: 0.0,
            fog: true
        })
    ];
    
    let buildingCount = 0;
    buildings.forEach((building, index) => {
        if (building.coordinates.length < 3) return;
        
        try {
            // Calculate building centroid for proper positioning
            let centroidX = 0, centroidZ = 0;
            for (const coord of building.coordinates) {
                centroidX += coord[0];
                centroidZ += coord[1];
            }
            centroidX /= building.coordinates.length;
            centroidZ /= building.coordinates.length;
            
            // Create building shape from coordinates relative to centroid
            const shape = new THREE.Shape();
            const firstPoint = building.coordinates[0];
            shape.moveTo(firstPoint[0] - centroidX, firstPoint[1] - centroidZ);
            
            for (let i = 1; i < building.coordinates.length; i++) {
                const point = building.coordinates[i];
                shape.lineTo(point[0] - centroidX, point[1] - centroidZ);
            }
            shape.lineTo(firstPoint[0] - centroidX, firstPoint[1] - centroidZ);
            
            // Varied building heights for visual interest
            const baseHeight = 5;
            const heightVariation = Math.random() * 15; // 5-20 meters
            const floors = Math.floor((baseHeight + heightVariation) / 3); // ~3m per floor
            const buildingHeight = floors * 3; // Snap to floor increments
            
            // Extrude building
            const extrudeSettings = {
                depth: buildingHeight,
                bevelEnabled: true,
                bevelThickness: 0.1,    // Subtle edge bevel
                bevelSize: 0.1,
                bevelSegments: 1
            };
            
            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geometry.rotateX(-Math.PI / 2);
            
            // Pick random base material and clone it for variation
            const baseMat = buildingBaseMaterials[
                Math.floor(Math.random() * buildingBaseMaterials.length)
            ].clone();
            
            // Add subtle per-building color variation
            baseMat.color.offsetHSL(
                0,                              // No hue shift
                (Math.random() - 0.5) * 0.08,  // Slight saturation variation
                (Math.random() - 0.5) * 0.12   // Lightness variation for weathering
            );
            
            // Occasional slightly darker buildings for visual rhythm
            if (Math.random() < 0.2) {
                baseMat.color.multiplyScalar(0.85);
            }
            
            const mesh = new THREE.Mesh(geometry, baseMat);
            mesh.position.set(centroidX, 0, centroidZ);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            buildingGroup.add(mesh);
            buildingCount++;
        } catch (error) {
            console.warn(`Error rendering building ${index}:`, error);
        }
    });
    
    scene.add(buildingGroup);
    console.log(`✅ Rendered ${buildingCount} buildings with PBR materials and variation`);
}

// Start animation loop immediately (for vehicle controls)
let animationStarted = false;
function startAnimation() {
    if (!animationStarted) {
        animationStarted = true;
        animate();
    }
}

// Load map data and start animation
loadMapData().then(() => {
    startAnimation();
}).catch((error) => {
    console.error("Map loading failed, starting simulator without map:", error);
    startAnimation();
});
