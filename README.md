# Autonomous Routing & Simulation Platform (Fremont, CA)

A comprehensive Flask-based web application for autonomous vehicle routing and 3D simulation using OpenStreetMap data, Dijkstra's algorithm, and Three.js for real-time visualization.

## Current Scope & Features

### 🗺️ Route Planning & Navigation
- **Address Autocomplete**: Real-time address suggestions using Nominatim API
- **Geocoding**: Automatic conversion from addresses to lat/lon coordinates
- **KD-Tree Spatial Indexing**: Efficient O(log N) nearest node lookup for fast routing
- **Dijkstra's Algorithm**: Custom implementation for shortest path routing with haversine distance weights
- **Route Visualization**: Path summary with distance, node count, and coordinate polyline

### 🎮 3D Simulator Environment
- **Three.js WebGL Rendering**: Browser-based 3D visualization with smooth 60 FPS performance
- **Real-World Map Data**: Fully rendered Fremont, CA road network and buildings from OSM data
- **Scaled Road Rendering**: Realistic road widths (4m-12m) based on highway type
- **Building Visualization**: Extruded building polygons with varied heights
- **Dynamic Ground Plane**: Automatically sized based on map bounds

### 🚗 Vehicle Physics & Controls
- **Bicycle Model Physics**: Realistic car dynamics with acceleration, braking, and steering
- **Manual Driving Controls**: WASD keys for acceleration, braking, and steering
- **SlowRoads.io-Style Animations**: Smooth vehicle tilting on curves and realistic wheel turning
- **Speed-Based Turning**: Automatic speed reduction during sharp turns for realism
- **Steering Constraints**: Maximum angular velocity and minimum turning radius limits

### 📹 Admin Camera System
- **Free Camera Movement**: Admin mode for inspection and debugging
- **X-Y-Z Navigation**: Arrow keys/WASD for movement, Q/E for vertical movement
- **Top-Down View**: Toggle-able aerial perspective for map inspection
- **Fast Movement Mode**: Shift key for 3x speed camera movement
- **Camera Reset**: Spacebar resets both vehicle and camera to initial positions

### 🏗️ Architecture
- **Modular Core Library**: Separate modules for graph building, routing, and spatial indexing
- **Flask REST API**: Clean separation between backend routing logic and frontend visualization
- **Efficient Data Structures**: NetworkX graphs, SciPy KD-trees, and optimized coordinate transformations
- **OSM Data Processing**: Custom handler for extracting roads and buildings with filtering support

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

Or install individually:
```bash
pip install Flask requests scipy networkx numpy matplotlib osmium
```

### 2. Ensure OSM Data File

Make sure `fremont_raw.osm` is in `data/osm/` directory. The OSM file should contain Fremont, CA map data with highway ways and building polygons.

**Note**: If you don't have the OSM file, you can download it from:
- [OpenStreetMap](https://www.openstreetmap.org/) - Export area covering Fremont, CA
- [Geofabrik](https://download.geofabrik.de/north-america/us/california.html) - California extracts

### 3. Run the Application

From the project root directory:

```bash
python3 -m web.app
```

Or:

```bash
cd web
python3 app.py
```

The server will:
- Load and parse the OSM graph data (30-60 seconds on first startup)
- Build the NetworkX directed graph with haversine edge weights
- Build the KD-tree spatial index for nearest node lookup
- Extract map data for 3D rendering (roads and buildings)
- Start Flask server on `http://127.0.0.1:5000`

You should see console output like:
```
Loading OSM data and building graph...
Building KD-tree from graph nodes only...
Extracting map data for 3D rendering...
✅ Graph loaded: X nodes, Y edges
✅ KD-tree built: Z nodes indexed
✅ Map data cached: A road segments, B buildings
```

### 4. Open in Browser

Navigate to: `http://127.0.0.1:5000`

## Usage

### Route Planning (Main Page)
1. Navigate to `http://127.0.0.1:5000`
2. Enter a start address in Fremont, CA
3. Enter an end address in Fremont, CA
4. Use autocomplete suggestions as you type
5. Click "Compute Route" to find the shortest path
6. View route summary with distance and node count

### 3D Simulator
1. Navigate to `http://127.0.0.1:5000/simulator`
2. **Manual Driving Controls**:
   - `W` - Accelerate
   - `S` - Brake/Reverse
   - `A` - Steer Left
   - `D` - Steer Right
   - `Space` - Reset vehicle position
3. **Admin Camera Mode** (Press `Tab` to toggle):
   - `Arrow Keys` / `WASD` - Move camera
   - `Q` / `E` - Move camera up/down
   - `Shift` - Fast movement (3x speed)
   - `T` - Toggle top-down view
   - `Space` - Reset camera and vehicle
   - `Tab` - Exit admin mode

## API Endpoints

### Route Planning
- `GET /` - Route planning interface
- `GET /autocomplete?q=<query>` - Address autocomplete suggestions
- `POST /get_latlon` - Convert addresses to coordinates and find nearest nodes
- `POST /compute_route` - Compute shortest path using Dijkstra's algorithm

### Simulator
- `GET /simulator` - 3D simulator interface
- `GET /api/map_data` - Get transformed map data (roads and buildings) for rendering

## Project Structure

```
.
├── core/                              # Core routing & data processing modules
│   ├── __init__.py
│   ├── graph_builder.py              # OSM parsing, graph construction, map extraction
│   ├── routing.py                    # Custom Dijkstra's algorithm implementation
│   └── spatial_index.py              # KD-tree spatial indexing for nearest node lookup
├── web/                               # Flask web application
│   ├── __init__.py
│   ├── app.py                        # Flask server with routing endpoints
│   ├── templates/
│   │   ├── index.html                # Route planning UI
│   │   └── simulator.html            # 3D simulator interface
│   └── static/
│       ├── style.css                 # Styling
│       ├── app.js                    # Route planning frontend
│       └── simulator.js              # 3D simulator with physics and controls
├── data/
│   └── osm/
│       ├── fremont_raw.osm           # Raw OSM data file
│       └── fremont.osm               # Processed OSM data (if applicable)
├── legacy/                            # Legacy scripts (for reference)
│   └── visualize_fremont.py          # Matplotlib visualization script
├── README.md
└── requirements.txt                   # Python dependencies
```

## Technical Details

### Graph Construction
- **Graph Type**: NetworkX Directed Graph (DiGraph) to support oneway streets
- **Edge Weights**: Haversine distance in meters between consecutive nodes
- **Highway Filtering**: Supports all vehicular highway types (motorway, primary, residential, etc.)
- **Oneway Handling**: Respects `oneway=yes` and `oneway=-1` tags for directional edges

### Coordinate Systems
- **OSM Format**: Latitude/Longitude (WGS84)
- **Simulator Format**: Local Cartesian coordinates (meters) centered at map center
- **Transformation**: Uses haversine formula with Earth radius for accurate local projection

### Performance Optimizations
- Graph and KD-tree loaded once on server startup (30-60 seconds initial load)
- Map data cached and served as JSON for frontend rendering
- Batched road rendering by type for efficient GPU rendering
- Smooth camera interpolation with lerp-based movement

### Browser Requirements
- Modern browser with WebGL support (Chrome, Firefox, Safari, Edge)
- ES6 modules support required for Three.js
- Recommended: 4GB+ RAM for smooth rendering of large maps

## Troubleshooting

**Import errors**: Make sure all dependencies are installed and you're running from the project root
```bash
pip install -r requirements.txt
```

**Graph loading slow**: First startup loads the entire OSM file (may take 30-60 seconds). This is normal.

**No autocomplete**: Check internet connection (requires Nominatim API). Rate limit: 1 request per second.

**Route not found**: Ensure addresses are within the Fremont area covered by the OSM data.

**Simulator not loading**: Check browser console for errors. Ensure WebGL is enabled in browser settings.

**Poor performance**: Reduce browser zoom level or disable hardware acceleration. Map rendering is optimized but may be slow on older hardware.

## Future Steps: Autonomous Vehicle Integration

### Phase 1: Path Following (Next Steps)
- [ ] **Route Integration**: Connect computed routes from Dijkstra to simulator
- [ ] **Path Visualization**: Display computed route as 3D path in simulator
- [ ] **Waypoint Navigation**: Vehicle follows waypoint sequence from route
- [ ] **PID Controller**: Implement steering and speed control for path following

### Phase 2: Localization & Perception
- [ ] **GPS Simulation**: Add simulated GPS with noise for position estimation
- [ ] **Sensor Models**: Implement IMU, wheel odometry, and LiDAR point cloud simulation
- [ ] **Localization Pipeline**: Kalman filter or particle filter for pose estimation
- [ ] **Map Matching**: Align vehicle position with road network

### Phase 3: Obstacle Avoidance
- [ ] **Dynamic Obstacles**: Add moving objects (other vehicles, pedestrians)
- [ ] **Collision Detection**: AABB/sphere-based collision detection with obstacles
- [ ] **Path Replanning**: Dynamic path adjustment when obstacles detected
- [ ] **Safety Buffer**: Maintain safe distance from obstacles

### Phase 4: Advanced Planning
- [ ] **Behavioral Planning**: Lane changes, merging, intersection handling
- [ ] **Traffic Rules**: Stop signs, traffic lights, right-of-way logic
- [ ] **Multi-Agent Simulation**: Multiple autonomous vehicles in shared environment
- [ ] **Decision Trees**: Rule-based behavior for common driving scenarios

### Phase 5: Learning-Based Approaches
- [ ] **Imitation Learning**: Train on expert driving demonstrations
- [ ] **Reinforcement Learning**: Reward-based learning for optimal policies
- [ ] **Neural Network Controllers**: End-to-end learning for steering/acceleration
- [ ] **Behavioral Cloning**: Clone human driver behavior from simulator data

### Phase 6: Real-World Integration
- [ ] **CARLA Integration**: Connect to CARLA simulator for more realistic physics
- [ ] **ROS Bridge**: ROS nodes for sensor data and control commands
- [ ] **Hardware-in-the-Loop**: Connect to real vehicle sensors/actuators
- [ ] **Field Testing**: Deploy on physical vehicle with safety systems

## Contributing

This is a research/educational project. Contributions, suggestions, and feedback are welcome!

## License

[Specify your license here]

## Acknowledgments

- OpenStreetMap contributors for Fremont, CA map data
- Nominatim API for geocoding and address autocomplete
- Three.js community for excellent 3D rendering library
- NetworkX and SciPy for efficient graph and spatial data structures
