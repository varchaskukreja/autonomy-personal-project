<!-- e23124dc-4e42-47b0-8e94-865171a115af 666160f9-7dd8-49be-93c2-aa100259fe7b -->
# Build Fremont Road Graph from OSM Data

## Overview

Create `graph_builder.py` that parses `fremont_raw.osm` and builds a NetworkX directed graph for routing. The graph will use haversine distance for edge weights and respect oneway street tags.

## Implementation Plan

### 1. Create OSM Handler Class

- Create `RoadGraphHandler` class extending `osmium.SimpleHandler`
- Store nodes: `node_id: (lat, lon)` in dictionary
- Track highway ways with their node sequences
- Check for `oneway` tags to determine edge directionality

### 2. Distance Calculation

- Implement haversine distance function using numpy
- Calculate distance between consecutive nodes in a way
- Use as edge weight in the graph

### 3. Graph Construction

- Initialize `networkx.DiGraph()`
- For each highway way:
- Iterate through consecutive node pairs
- Calculate haversine distance as weight
- If `oneway=yes` or `oneway=-1`: add edge in specified direction only
- Otherwise: add bidirectional edges `(u, v)` and `(v, u)`
- Store all nodes in `nodes_dict` with format `{node_id: (lat, lon)}`

### 4. Main Function

- `build_graph(osm_file: str) -> tuple[networkx.DiGraph, dict]`
- Returns `(graph, nodes_dict)`
- Prints statistics: number of nodes and edges

### 5. Optional Visualization

- Function to plot graph edges using matplotlib
- Thin black lines for roads
- Similar style to `visualize_fremont.py` but focused on graph structure

### 6. Testing/Example Usage

- `if __name__ == "__main__"` block
- Load `fremont_raw.osm`
- Build graph and print statistics
- Optionally visualize

## Key Implementation Details

- **Node storage**: `{node_id: (lat, lon)}` as specified
- **Edge weights**: Haversine distance in appropriate units (meters or kilometers)
- **Oneway handling**: Check `oneway` tag - if `yes`, add edge forward; if `-1`, add edge backward; otherwise bidirectional
- **Graph type**: `networkx.DiGraph()` to support directional edges
- **Error handling**: Skip ways with missing nodes or invalid coordinates

## Files to Create

- `graph_builder.py` - Main script with handler, graph builder, and visualization

### To-dos

- [x] Create RoadGraphHandler class to parse OSM nodes and highway ways, storing nodes and tracking oneway tags
- [x] Implement haversine distance function for calculating edge weights between geographic coordinates
- [x] Implement build_graph() function that creates NetworkX DiGraph with bidirectional edges (respecting oneway tags) and haversine weights
- [x] Add optional visualization function to plot graph edges using matplotlib
- [x] Add main block to test build_graph() with fremont_raw.osm and print statistics