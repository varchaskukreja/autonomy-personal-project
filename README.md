Absolutely—I can create a fully updated README that merges your current version with all the missing details from your “info you want,” so nothing is left out. Here’s a comprehensive draft:

---

# Autonomous Routing & Simulation Platform (Fremont, CA)

A comprehensive Flask-based web application for autonomous vehicle routing and 3D simulation using OpenStreetMap data, Dijkstra's algorithm, and Three.js for real-time visualization. Features realistic traffic simulation with AI-controlled vehicles, traffic light systems, and collision avoidance.

---

## Current Scope & Features

### 🗺️ Route Planning & Navigation

* **Address Autocomplete**: Real-time suggestions via Nominatim API
* **Geocoding**: Convert addresses to lat/lon coordinates
* **KD-Tree Spatial Indexing**: Efficient nearest node lookup (O(log N))
* **Dijkstra's Algorithm**: Custom shortest-path routing with haversine distance
* **Route Visualization**: Distance, node count, and coordinate polyline

---

### 🎮 3D Simulator Environment

* **Three.js WebGL Rendering**: Smooth 60 FPS browser-based visualization
* **Real-World Map Data**: Fremont, CA roads & buildings from OSM
* **Scaled Road Rendering**: Road widths 4–12m based on type
* **Building Visualization**: Extruded polygons with varied heights
* **Dynamic Ground Plane**: Automatically sized to map bounds
* **Procedural Nebula Sky**: Animated stars and atmospheric clouds

---

### 🚗 Vehicle Physics & Controls

* **Bicycle Model Physics**: Realistic acceleration, braking, and steering dynamics
* **Manual Driving Controls**: WASD keys for movement
* **SlowRoads.io-Style Animations**: Tilting and wheel rotation on curves
* **Speed-Based Turning**: Automatic speed reduction on sharp turns
* **Steering Constraints**: Angular velocity & minimum turning radius limits
* **Teleportation System**: Jump to any address or coordinates

---

### 🤖 Autopilot System

* **Pure Pursuit Steering**: Lookahead-based path following
* **Waypoint Navigation**: Automatic route traversal
* **Curvature-Based Speed Control**: Adjust speed based on path curvature
* **Steering Oscillation Damping**: Prevents zigzag behavior
* **Route Integration**: Connects route planner directly to autopilot

---

### 🚦 Traffic Light System

* **Automatic Intersection Detection**: Identifies intersections from road network
* **Multi-Phase Signal Timing**: NS/EW straight & left-turn phases
* **Signal State Machine**: GREEN → YELLOW → RED cycling
* **Left-Turn Arrows**: Dedicated left-turn signals
* **Traffic Light Compliance**: Vehicles detect and obey lights

  * Approach detection with scoring
  * Yellow light logic (stop vs. proceed)
  * Smooth deceleration curves

---

### 🚙 AI Traffic System

* **Autonomous AI Vehicles**: Up to 8 AI cars sharing the road
* **Relevance-Based Spawning**: AI spawns near ego on main roads
* **Local Path Planning**: AI follows roads and decides turns at intersections
* **Intersection Branching**: Weighted random decisions (50% straight, 30% right, 20% left)
* **Traffic Light Obedience**: AI respects traffic signals
* **Lifecycle Management**: AI despawns when out of camera range, path completed, or lifetime exceeded

---

### 🚧 Collision Avoidance System

* **Forward Detection Cone**: 50m range, 60° angle
* **Safe Following Distance**: 12m minimum
* **Emergency Braking**: Aggressive braking < 6m
* **Gradual Slowdown**: Proportional to distance
* **Multi-Vehicle Awareness**: Ego and AI vehicles avoid collisions
* **Approach Detection**: Tracks relative velocity

---

### 📹 Camera Systems

* **Follow Camera**: Smooth third-person tracking
* **Admin Camera Mode**: Free movement for debugging

  * WASD/Arrow keys + Q/E for X-Y-Z movement
  * Shift for fast movement
  * Top-down view toggle
  * Spacebar resets vehicle & camera

---

### 🛠️ Debug & Development Tools

* Traffic light scoring visuals
* Waypoint markers toggle
* Spawn location markers
* Console logging for AI & traffic decisions

---

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

Or individually:

```bash
pip install Flask requests scipy networkx numpy matplotlib osmium
```

### 2. Ensure OSM Data File

Place `fremont_raw.osm` in `data/osm/`. Download options:

* [OpenStreetMap](https://www.openstreetmap.org/)
* [Geofabrik California Extracts](https://download.geofabrik.de/north-america/us/california.html)

### 3. Run the Application

```bash
python3 -m web.app
# or
cd web
python3 app.py
```

Server startup includes:

* Loading & parsing OSM graph (30–60s first time)
* Building NetworkX graph & KD-tree
* Extracting 3D map data
* Flask server at `http://127.0.0.1:5000`

### 4. Open in Browser

Navigate to `http://127.0.0.1:5000`

---

## Usage

### Route Planning

1. Enter start/end addresses in Fremont, CA
2. Select autocomplete suggestions
3. Click "Compute Route" for shortest path
4. Click "Drive Route" to open simulator with autopilot

### 3D Simulator

* **Manual Driving**: W/A/S/D for movement, Space to reset
* **Admin Camera Mode (Tab)**:

  * WASD/Arrow keys + Q/E for movement
  * Shift for fast movement
  * T for top-down view
  * Space resets vehicle & camera

### Teleportation

Jump to addresses or lat/lon coordinates, optional heading.

---

## API Endpoints

| Endpoint         | Method | Description                      |
| ---------------- | ------ | -------------------------------- |
| /                | GET    | Route planning UI                |
| /autocomplete?q= | GET    | Address suggestions              |
| /get_latlon      | POST   | Convert addresses to coordinates |
| /compute_route   | POST   | Dijkstra shortest path           |
| /simulator       | GET    | 3D simulator interface           |
| /api/map_data    | GET    | Roads & buildings JSON           |
| /api/teleport    | POST   | Teleport vehicle                 |

---

## Project Structure

```
.
├── core/                 # Routing & processing modules
├── web/                  # Flask app & static files
├── data/osm/             # OSM data
├── legacy/               # Legacy scripts
├── README.md
└── requirements.txt
```

---

## Technical Details

* **Graph**: NetworkX DiGraph, haversine edge weights
* **OSM → Simulator Coordinates**: Local Cartesian projection
* **AI Cars Config**: Max 8, spawn near ego, collision & despawn logic
* **Traffic Light Timings**: Straight Green 10s, Left Green 5s, Yellow 2s
* **Optimizations**: Graph & KD-tree caching, batched rendering, spatial filtering for AI collision

---

## Browser Requirements

* WebGL-enabled modern browser (Chrome, Firefox, Safari, Edge)
* ES6 modules
* ≥4GB RAM recommended

---

## Contributing

Research/educational project. Feedback, suggestions, and contributions welcome.

---

## License

[Specify license here]

---

## Acknowledgments

* OpenStreetMap contributors
* Nominatim API
* Three.js community
* NetworkX & SciPy libraries

---
