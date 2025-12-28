# Fremont Route Planner

A Flask-based web application for computing shortest routes between addresses in Fremont, CA using OpenStreetMap data and Dijkstra's algorithm.

## Features

- 🗺️ Address autocomplete using Nominatim API
- 📍 Automatic geocoding (address → lat/lon)
- 🔍 KD-tree spatial indexing for nearest node lookup
- 🚗 Dijkstra's algorithm for shortest path routing
- 📊 Route visualization with distance and node count
- 🎨 Modern, responsive UI

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

Make sure `fremont_raw.osm` is in the project directory.

### 3. Run the Application

```bash
python app.py
```

The server will:
- Load the OSM graph data
- Build the KD-tree spatial index
- Start Flask on `http://127.0.0.1:5000`

### 4. Open in Browser

Navigate to: `http://127.0.0.1:5000`

## Usage

1. Enter a start address in Fremont, CA
2. Enter an end address in Fremont, CA
3. Use autocomplete suggestions as you type
4. Click "Compute Route" to find the shortest path
5. View route summary with distance and node count

## API Endpoints

- `GET /` - Main page
- `GET /autocomplete?q=<query>` - Address autocomplete
- `POST /get_latlon` - Convert addresses to coordinates and find nearest nodes
- `POST /compute_route` - Compute shortest path using Dijkstra

## Project Structure

```
.
├── app.py                          # Flask server
├── graph_builder.py                # OSM graph construction
├── dijkstra.py                     # Dijkstra algorithm
├── spatial_nearest_node_finder.py  # KD-tree spatial index
├── templates/
│   └── index.html                  # Main UI
├── static/
│   ├── style.css                  # Styling
│   └── app.js                     # Frontend JavaScript
├── fremont_raw.osm                # OSM data file
└── requirements.txt               # Python dependencies
```

## Notes

- Nominatim API has a rate limit of 1 request per second
- The graph and KD-tree are loaded once on server startup for performance
- Routes are computed using haversine distance as edge weights
- The application works on both Windows and macOS

## Troubleshooting

**Import errors**: Make sure all dependencies are installed
**Graph loading slow**: First startup loads the entire OSM file (may take 30-60 seconds)
**No autocomplete**: Check internet connection (requires Nominatim API)
**Route not found**: Ensure addresses are within the Fremont area covered by the OSM data

