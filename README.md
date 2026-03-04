# Browser-Based Autonomous Driving Simulator

A full-stack autonomous driving simulation platform that converts real-world map data into a live, interactive 3D driving environment with rule-based vehicle autonomy.

This project demonstrates end-to-end ownership of geospatial data processing, graph algorithms, backend systems, and real-time frontend simulation, without relying on pretrained ML models or black-box libraries.

FULL DOCUMENTATION + DEMO AVAILABLE: https://docs.google.com/document/d/1M6x9Wmv_5Q7r__BNDpPWw4lN3B13wMNRhdAbH1TBTkU/edit?usp=sharing
---

## 🏎️ Overview

This simulator allows users to enter real-world start and destination addresses, computes a drivable route using **OpenStreetMap (OSM)** data, and visualizes the journey in a browser-based 3D environment. The vehicle follows the route autonomously while obeying traffic lights, avoiding other vehicles, and maintaining lane discipline.

The system is designed to be **deterministic, interpretable, and debuggable**, prioritizing classical algorithms and control logic over opaque machine learning approaches.

---

## ✨ Key Features

* **Real-world Routing:** Parses OSM data, constructs a directed road graph, and computes shortest paths via a custom Dijkstra implementation.
* **Autonomous Vehicle Control:** Steering and throttle computed from waypoint geometry with traffic light detection and dynamic collision avoidance.
* **Interactive 3D Simulation:** Browser-based visualization using **Three.js** with procedurally generated roads, terrain, and buildings.
* **Full-Stack Architecture:** Python backend for routing and spatial indexing with a Flask API serving a JavaScript-driven frontend.

---

## 🛠️ Tech Stack

### Backend

* **Language:** Python
* **Framework:** Flask
* **Data:** OpenStreetMap (OSM), Nominatim Geocoding API
* **Logic:** Custom graph construction + spatial indexing

### Frontend

* **Engine:** Three.js (WebGL)
* **Language:** JavaScript (ES6)
* **Styling:** HTML5 / CSS3

### Algorithms & Data Structures

* **Directed Graphs:** For road network representation
* **Dijkstra’s Algorithm:** Manual implementation for shortest pathing
* **KD-Tree:** For  nearest-node spatial lookups
* **Deterministic Control:** Rule-based steering and acceleration logic

---

## 📂 Project Structure

```text
.
├── core/                       # Geospatial processing & routing engine (Python)
│   ├── graph_builder.py        # OSM → directed road graph construction
│   ├── routing.py              # Custom Dijkstra implementation
│   └── spatial_index.py        # KD-tree nearest-node lookup
│
├── data/
│   └── osm/
│       ├── fremont_raw.osm     # Raw OSM XML extract
│       └── fremont.osm         # Cleaned / filtered OSM data
│
├── web/                        # Web application & simulation runtime
│   ├── app.py                  # Flask app entry point & API routes
│   ├── static/
│   │   ├── app.js              # Frontend UI logic
│   │   ├── simulator.js        # Three.js simulation + autonomy loop
│   │   └── style.css           # UI styling
│   └── templates/
│       ├── index.html          # Route planner UI
│       └── simulator.html      # 3D simulation interface
│
├── requirements.txt
└── README.md

```

---

## ⚙️ System Execution Flow

1. **Backend Initialization:** OSM data is parsed, a directed road graph is constructed, and a KD-tree is built for coordinate snapping.
2. **Route Request:** User inputs are geocoded via Nominatim, snapped to graph nodes, and the shortest path is computed and sent to the frontend.
3. **Simulation Launch:** Three.js initializes the 3D world, procedurally generating the environment and spawning traffic.
4. **Runtime Loop:** Every frame, the vehicle updates steering based on waypoint geometry, traffic light states, and proximity to other AI vehicles.
5. **Reset & Relaunch:** The state is torn down on reset, allowing for immediate new route computation without reloading backend assets.

---

## 🧠 Autonomy Design & Decisions

The vehicle autonomy is rule-based to ensure **predictable behavior** and **clear reasoning** during code reviews.

* **Path Following:** Lookahead-based steering.
* **Traffic Logic:** Full stops at red lights and conditional slowdowns at yellow.
* **Collision Avoidance:** Dynamic deceleration based on AI traffic proximity.
* **Why No ML?** Prioritized interpretability and engineering judgment over statistical approximation.
* **Why Three.js?** Reduced setup complexity compared to heavy simulators like CARLA, improving accessibility.

---

## 🚀 How to Run

1. **Install dependencies:**
```bash
pip install -r requirements.txt

```


2. **Start the server:**
```bash
python3 -m web.app

```


3. **Launch:** Open the provided local URL (usually `http://127.0.0.1:5000`) and enter a start/end address.

---

Please direct all inquiries to varchas@umich.edu. Thank you!
