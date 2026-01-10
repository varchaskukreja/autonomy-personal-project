import * as THREE from 'three';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue
scene.fog = new THREE.Fog(0x87ceeb, 100, 500);

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('container').appendChild(renderer.domElement);

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

// Ground plane
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x90ee90, // Light green grass
    side: THREE.DoubleSide
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// Grid helper
const gridHelper = new THREE.GridHelper(200, 50, 0x444444, 0x222222);
scene.add(gridHelper);

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

// Input handling
const keys = {
    w: false,
    s: false,
    a: false,
    d: false,
    space: false
};

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || key === 's' || key === 'a' || key === 'd') {
        keys[key] = true;
        e.preventDefault();
    }
    if (key === ' ') {
        keys.space = true;
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || key === 's' || key === 'a' || key === 'd') {
        keys[key] = false;
        e.preventDefault();
    }
    if (key === ' ') {
        keys.space = false;
        e.preventDefault();
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
    // Steering input (target steering)
    if (keys.a) {
        vehicle.steering = Math.max(vehicle.steering - STEERING_RATE * deltaTime, -vehicle.maxSteeringAngle);
    } else if (keys.d) {
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

    // Throttle/Brake input
    if (keys.w) {
        vehicle.acceleration = ACCELERATION_RATE;
    } else if (keys.s) {
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

    // Reset position with spacebar
    if (keys.space) {
        vehicle.x = 0;
        vehicle.z = 0;
        vehicle.angle = 0;
        vehicle.velocity = 0;
        vehicle.steering = 0;
        vehicle.steeringActual = 0;
        vehicle.tilt = 0;
        vehicle.tiltTarget = 0;
    }
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

// Camera follow with smooth interpolation
function updateCamera() {
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

    // Update physics
    updatePhysics(deltaTime);

    // Update visuals
    updateVehicleVisuals();

    // Update camera
    updateCamera();

    // Update UI
    updateUI();

    // Render
    renderer.render(scene, camera);
}

// Start animation
animate();
