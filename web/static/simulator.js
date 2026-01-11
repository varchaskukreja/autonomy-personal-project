import * as THREE from 'three';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue
scene.fog = new THREE.Fog(0x87ceeb, 200, 2000); // Adjusted for larger map

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

// Ground plane (will be resized when map loads)
let ground = null;
let gridHelper = null;

function createGround(size = 2000) {
    // Remove old ground if exists
    if (ground) scene.remove(ground);
    if (gridHelper) scene.remove(gridHelper);
    
    const groundGeometry = new THREE.PlaneGeometry(size, size);
    const groundMaterial = new THREE.MeshLambertMaterial({ 
        color: 0x90ee90, // Light green grass
        side: THREE.DoubleSide
    });
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid helper
    gridHelper = new THREE.GridHelper(size, size / 50, 0x444444, 0x222222);
    scene.add(gridHelper);
}

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
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, 100, 50);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.left = -100;
directionalLight.shadow.camera.right = 100;
directionalLight.shadow.camera.top = 100;
directionalLight.shadow.camera.bottom = -100;
scene.add(directionalLight);

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
const STEERING_SMOOTH = 12.0; // steering smoothing rate (higher = smoother)
const FRICTION = 0.98; // velocity decay when no input (higher = less friction)
const MIN_SPEED_FOR_TURN = 0.3; // minimum speed to allow turning
const MAX_ANGULAR_VELOCITY = 1.2; // rad/s - maximum rotation speed (prevents instant 360s)
const MIN_TURNING_RADIUS = 4.0; // meters - minimum realistic turning radius
const TURN_SPEED_REDUCTION = 0.4; // how much speed is reduced during turns (0-1, higher = more reduction)
const BASE_MAX_SPEED = 25.0; // m/s (~56 mph) - base max speed

// Bicycle model physics
function updatePhysics(deltaTime) {
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

    // Update velocity
    vehicle.velocity += vehicle.acceleration * deltaTime;
    
    // Speed reduction during turns (realistic: can't maintain max speed while turning sharply)
    // More steering = more speed reduction
    const steeringFactor = Math.abs(vehicle.steeringActual) / vehicle.maxSteeringAngle; // 0 to 1
    const speedReductionFactor = 1.0 - (steeringFactor * TURN_SPEED_REDUCTION); // 1.0 to 0.6
    const effectiveMaxSpeed = BASE_MAX_SPEED * speedReductionFactor;
    
    // Clamp velocity with turn-based max speed
    vehicle.velocity = Math.max(-effectiveMaxSpeed * 0.5, Math.min(effectiveMaxSpeed, vehicle.velocity));

    // Only allow turning when moving (more realistic - cars can't turn in place)
    const effectiveSteering = Math.abs(vehicle.velocity) > MIN_SPEED_FOR_TURN 
        ? vehicle.steeringActual 
        : 0;

    // Bicycle model equations - use actual smoothed steering
    // θ += (v / L) * tan(δ) * dt
    // Only turn if moving
    if (Math.abs(vehicle.velocity) > MIN_SPEED_FOR_TURN) {
        // Calculate angular velocity from bicycle model
        let angularVel = (vehicle.velocity / vehicle.wheelbase) * Math.tan(effectiveSteering);
        
        // Limit angular velocity to prevent instant 360s and unrealistic turning
        // This enforces a minimum turning radius based on speed
        const maxAngularVel = Math.abs(vehicle.velocity) / MIN_TURNING_RADIUS;
        angularVel = Math.max(-Math.min(MAX_ANGULAR_VELOCITY, maxAngularVel), 
                             Math.min(MAX_ANGULAR_VELOCITY, maxAngularVel, angularVel));
        
        vehicle.angularVelocity = angularVel;
        vehicle.angle += vehicle.angularVelocity * deltaTime;
    } else {
        // No turning when stationary or moving too slowly
        vehicle.angularVelocity = 0;
    }

    // In three.js: X is left/right, Z is forward/backward
    // For angle=0, we want to move forward (negative Z direction)
    // x += v * sin(θ) * dt (horizontal movement)
    // z -= v * cos(θ) * dt (forward movement, negative because +Z goes into screen)
    vehicle.x += vehicle.velocity * Math.sin(vehicle.angle) * deltaTime;
    vehicle.z -= vehicle.velocity * Math.cos(vehicle.angle) * deltaTime;

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
        
        // Update vehicle position
        const pos = data.position;
        vehicle.x = pos.x;
        vehicle.z = pos.z;
        vehicle.angle = -data.yaw_rad; // Negative because our angle system is inverted
        
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
}

// Animation loop
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1); // Cap at 100ms to prevent large jumps
    lastTime = currentTime;

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
        
        // Debug: optionally show node markers (comment out for production)
        // renderDebugNodeMarkers(mapData.roads);

        // Center vehicle at map center (0, 0 after transformation)
        vehicle.x = 0;
        vehicle.z = 0;
        carGroup.position.set(0, 0, 0);
        
        statusEl.textContent = `✅ Map loaded: ${mapData.roads.length} roads, ${mapData.buildings.length} buildings`;
        statusEl.style.color = "#4caf50";
        
        console.log("Map data loaded and rendered");
    } catch (error) {
        console.error("Error loading map data:", error);
        statusEl.textContent = "⚠️ Map loading failed - simulator running without map";
        statusEl.style.color = "#ff4444";
        // Continue without map data
    }
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

// Ultra-optimized: Batch roads by type into single meshes (best for 21k+ roads)

function renderRoads(roads) {
    // Road type styles
    const roadTypeStyles = {
        'motorway': { color: 0x2a2a2a, width: 12 },
        'trunk': { color: 0x333333, width: 10 },
        'primary': { color: 0x444444, width: 8 },
        'secondary': { color: 0x555555, width: 7 },
        'tertiary': { color: 0x666666, width: 6 },
        'residential': { color: 0x777777, width: 5 },
        'unclassified': { color: 0x888888, width: 5 },
        'service': { color: 0x999999, width: 4 },
        'living_street': { color: 0x777777, width: 5 }
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
    
    // Create one mesh per road type (much fewer draw calls)
    Object.keys(roadsByType).forEach(roadType => {
        const style = roadTypeStyles[roadType] || { color: 0x666666, width: 5 };
        const roadWidth = style.width;
        const color = style.color;
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
        
        const material = new THREE.MeshLambertMaterial({ 
            color: color,
            side: THREE.DoubleSide
        });
        
        const roadMesh = new THREE.Mesh(geometry, material);
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
    if (minX !== Infinity) {
        console.log(`Map bounds: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}], Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
    }
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
function renderBuildings(buildings) {
    const buildingGroup = new THREE.Group();
    
    // Building material
    const buildingMaterial = new THREE.MeshLambertMaterial({ 
        color: 0xcccccc,
        side: THREE.DoubleSide
    });
    
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
            // THREE.Shape uses coordinates relative to its origin, so we offset by centroid
            const shape = new THREE.Shape();
            const firstPoint = building.coordinates[0];
            shape.moveTo(firstPoint[0] - centroidX, firstPoint[1] - centroidZ); // Offset by centroid
            
            for (let i = 1; i < building.coordinates.length; i++) {
                const point = building.coordinates[i];
                shape.lineTo(point[0] - centroidX, point[1] - centroidZ); // Offset by centroid
            }
            shape.lineTo(firstPoint[0] - centroidX, firstPoint[1] - centroidZ); // Close the shape
            
            // Extrude building
            const extrudeSettings = {
                depth: 5 + Math.random() * 10, // Random height between 5-15 meters
                bevelEnabled: false
            };
            
            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geometry.rotateX(-Math.PI / 2); // Rotate to lay flat on XZ plane (Shape XY -> World XZ)
            
            const mesh = new THREE.Mesh(geometry, buildingMaterial);
            // Position mesh at building's centroid in world space
            // After rotateX(-PI/2), Shape's Y becomes world Z, so we use (centroidX, 0, centroidZ)
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
    console.log(`Rendered ${buildingCount} buildings`);
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
