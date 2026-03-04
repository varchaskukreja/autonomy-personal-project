import osmium
import networkx as nx
import numpy as np
import matplotlib.pyplot as plt
from typing import List, Tuple, Dict


"""
Parses OSM data, builds the NetworkX road graph. Imported and used by app.py, so it’s part of the final runtime. -- project final
"""

def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points on Earth
    using the Haversine formula.
    
    Args:
        lat1, lon1: Latitude and longitude of first point in degrees
        lat2, lon2: Latitude and longitude of second point in degrees
    
    Returns:
        Distance in meters
    """
    # Earth radius in meters
    R = 6371000
    
    # Convert degrees to radians
    phi1 = np.radians(lat1)
    phi2 = np.radians(lat2)
    delta_phi = np.radians(lat2 - lat1)
    delta_lambda = np.radians(lon2 - lon1)
    
    # Haversine formula
    a = np.sin(delta_phi / 2)**2 + np.cos(phi1) * np.cos(phi2) * np.sin(delta_lambda / 2)**2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    
    distance = R * c
    return distance


class RoadGraphHandler(osmium.SimpleHandler):
    """Handler to extract nodes and highway ways from OSM data for graph building."""
    
    def __init__(self, extract_buildings=False):
        super().__init__()
        self.nodes = {}  # Store node coordinates: {node_id: (lat, lon)}
        self.highways = []  # Store highway ways: [(node_ids, oneway_tag, highway_type), ...]
        self.buildings = []  # Store building ways: [(node_ids), ...] (only if extract_buildings=True)
        self.extract_buildings = extract_buildings
    
    def node(self, n):
        """Store node coordinates by ID."""
        if n.location.valid():
            self.nodes[n.id] = (n.location.lat, n.location.lon)
    
    def way(self, w):
        """Extract ways tagged as highway and track oneway information."""
        if 'highway' in w.tags:
            highway_type = w.tags.get('highway', '')
            
            # Exclude non-vehicular highway types
            excluded_types = {
                'footway', 'cycleway', 'path', 'steps', 'pedestrian', 
                'bridleway', 'bus_guideway', 'escape', 'raceway'
            }
            
            # Only include vehicular roads
            if highway_type not in excluded_types:
                # Get node IDs for this way
                node_ids = [node.ref for node in w.nodes]
                
                # Check for oneway tag
                oneway = w.tags.get('oneway', 'no')
                
                # Only add if we have at least 2 nodes
                if len(node_ids) >= 2:
                    self.highways.append((node_ids, oneway, highway_type))
        
        # Extract buildings if requested (for 3D rendering)
        if self.extract_buildings and 'building' in w.tags:
            node_ids = [node.ref for node in w.nodes]
            if len(node_ids) >= 3:  # Buildings need at least 3 nodes (polygon)
                self.buildings.append(node_ids)


def build_graph(osm_file):
    """
    Build a NetworkX directed graph from OSM file.
    
    Args:
        osm_file: Path to the OSM file
    
    Returns:
        tuple: (graph, nodes_dict) where graph is a NetworkX DiGraph
               and nodes_dict is {node_id: (lat, lon)}
    """
    # Parse OSM data
    handler = RoadGraphHandler()
    handler.apply_file(osm_file)
    
    # Create directed graph
    graph = nx.DiGraph()
    nodes_dict = handler.nodes.copy()
    
    # Add edges for each highway way
    for node_ids, oneway, highway_type in handler.highways:
        # Skip if we don't have valid coordinates for all nodes
        valid_nodes = [nid for nid in node_ids if nid in handler.nodes]
        
        if len(valid_nodes) < 2:
            continue
        
        # Iterate through consecutive node pairs
        for i in range(len(valid_nodes) - 1):
            u = valid_nodes[i]
            v = valid_nodes[i + 1]
            
            # Get coordinates
            lat1, lon1 = handler.nodes[u]
            lat2, lon2 = handler.nodes[v]
            
            # Calculate haversine distance
            weight = haversine_distance(lat1, lon1, lat2, lon2)
            
            # Add edges based on oneway tag
            if oneway == 'yes':
                # Oneway forward: add edge from u to v
                graph.add_edge(u, v, weight=weight)
            elif oneway == '-1':
                # Oneway backward: add edge from v to u
                graph.add_edge(v, u, weight=weight)
            else:
                # Bidirectional: add edges in both directions
                graph.add_edge(u, v, weight=weight)
                graph.add_edge(v, u, weight=weight)
    
    return graph, nodes_dict


def extract_map_data_for_rendering(osm_file: str) -> Dict:
    """
    Extract roads and buildings from OSM for 3D rendering.
    Matches visualize_fremont.py behavior: includes ALL highways (no filtering).
    Uses existing RoadGraphHandler but with modified filtering.
    
    Args:
        osm_file: Path to OSM file
    
    Returns:
        dict with 'nodes', 'roads', and 'buildings' keys
    """
    import osmium
    
    # Create a handler that matches visualize_fremont.py behavior (no highway filtering)
    class MapDataHandler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.nodes = {}
            self.highways = []  # Store as (node_ids, highway_type)
            self.buildings = []
        
        def node(self, n):
            """Store node coordinates by ID."""
            if n.location.valid():
                self.nodes[n.id] = (n.location.lat, n.location.lon)
        
        def way(self, w):
            """Extract ALL highways (matching visualize_fremont.py) and buildings."""
            node_ids = [node.ref for node in w.nodes]
            
            # Extract ALL highways (no filtering, matching visualize_fremont.py)
            if 'highway' in w.tags:
                highway_type = w.tags.get('highway', '')
                if len(node_ids) >= 2:
                    self.highways.append((node_ids, highway_type))
            
            # Extract buildings
            if 'building' in w.tags:
                if len(node_ids) >= 3:
                    self.buildings.append(node_ids)
    
    # Parse OSM data with handler that matches visualize_fremont.py
    handler = MapDataHandler()
    handler.apply_file(osm_file)
    
    # Extract roads from highways (full way segments, preserving all nodes)
    road_segments = []
    for node_ids, highway_type in handler.highways:
        coords = []
        for node_id in node_ids:
            if node_id in handler.nodes:
                lat, lon = handler.nodes[node_id]
                coords.append((lat, lon))
        if len(coords) >= 2:
            road_segments.append({
                'coordinates': coords,
                'type': highway_type
            })
    
    # Extract buildings
    building_polygons = []
    for node_ids in handler.buildings:
        coords = []
        for node_id in node_ids:
            if node_id in handler.nodes:
                lat, lon = handler.nodes[node_id]
                coords.append((lat, lon))
        if len(coords) >= 3:
            building_polygons.append({
                'coordinates': coords
            })
    
    return {
        'nodes': handler.nodes,
        'roads': road_segments,
        'buildings': building_polygons
    }


def latlon_to_local_meters(lat: float, lon: float, center_lat: float, center_lon: float) -> Tuple[float, float]:
    """
    Convert lat/lon to local Cartesian coordinates in meters.
    
    Args:
        lat, lon: Point coordinates
        center_lat, center_lon: Reference point (center of map)
    
    Returns:
        (x, z) in meters (x = east, z = north)
    """
    import math
    
    # Earth radius in meters
    R = 6371000
    
    # Convert to radians
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    center_lat_rad = math.radians(center_lat)
    center_lon_rad = math.radians(center_lon)
    
    # Calculate offsets in meters
    # Note: X is negated to fix left-right mirror inversion
    # This ensures the simulator matches real-world orientation
    x = -R * (lon_rad - center_lon_rad) * abs(math.cos(center_lat_rad))
    z = R * (lat_rad - center_lat_rad)
    
    return (x, z)


def transform_map_data_for_rendering(map_data: Dict, center_lat: float, center_lon: float) -> Dict:
    """
    Transform map data from lat/lon to local Cartesian coordinates for 3D rendering.
    Uses the same coordinate transform for both roads and buildings to ensure spatial parity.
    This matches the matplotlib visualization approach (no rotation applied).
    
    Args:
        map_data: Output from extract_map_data_for_rendering()
        center_lat, center_lon: Reference point for coordinate system
    
    Returns:
        Transformed map data with coordinates in meters
    """
    # Transform roads - use unified transform function
    transformed_roads = []
    for road in map_data['roads']:
        transformed_coords = []
        for lat, lon in road['coordinates']:
            x, z = latlon_to_local_meters(lat, lon, center_lat, center_lon)
            transformed_coords.append((x, z))
        transformed_roads.append({
            'coordinates': transformed_coords,
            'type': road.get('type', 'road')
        })
    
    # Transform buildings - use SAME transform as roads (no rotation)
    # This ensures buildings and roads share the same coordinate space,
    # matching the matplotlib visualization which plots both in raw lat/lon space
    transformed_buildings = []
    
    # Position of the problematic building to remove (in simulator coordinates)
    PROBLEMATIC_BUILDING_X = -1806.2
    PROBLEMATIC_BUILDING_Z = -961.8
    REMOVAL_RADIUS = 50.0  # Remove buildings within 50m of this position
    
    for building in map_data['buildings']:
        transformed_coords = []
        for lat, lon in building['coordinates']:
            x, z = latlon_to_local_meters(lat, lon, center_lat, center_lon)
            transformed_coords.append((x, z))
        
        # Calculate building centroid to check if it's the problematic building
        if len(transformed_coords) >= 3:
            centroid_x = sum(coord[0] for coord in transformed_coords) / len(transformed_coords)
            centroid_z = sum(coord[1] for coord in transformed_coords) / len(transformed_coords)
            
            # Check distance from problematic building position
            distance = ((centroid_x - PROBLEMATIC_BUILDING_X)**2 + 
                       (centroid_z - PROBLEMATIC_BUILDING_Z)**2)**0.5
            
            # Skip this building if it's near the problematic position
            if distance < REMOVAL_RADIUS:
                continue
        
        transformed_buildings.append({
            'coordinates': transformed_coords
        })
    
    return {
        'roads': transformed_roads,
        'buildings': transformed_buildings,
        'center': (center_lat, center_lon)
    }


def path_to_coordinates(path: List[int], nodes_dict: dict) -> List[Tuple[float, float]]:
    """
    Transform a list of OSM node IDs into an ordered list of (lat, lon) coordinates.
    
    Args:
        path: List of node IDs from Dijkstra's algorithm
        nodes_dict: Dictionary mapping node_id to (lat, lon)
    
    Returns:
        List of tuples: [(lat1, lon1), (lat2, lon2), ...] in the same order as path
    
    Example:
        path = [123, 456, 789]
        nodes_dict = {123: (37.5, -122.0), 456: (37.6, -122.1), 789: (37.7, -122.2)}
        result = [(37.5, -122.0), (37.6, -122.1), (37.7, -122.2)]
    """
    coordinates = []
    
    for node_id in path:
        if node_id in nodes_dict:
            coordinates.append(nodes_dict[node_id])
        else:
            # Gracefully handle missing nodes - skip them with a warning
            print(f"Warning: Node {node_id} not found in nodes_dict, skipping")
    
    return coordinates

# note: this was for debugging mostly, can be ignored
def visualize_graph(graph, nodes_dict, path=None):
    """
    Visualize the road graph using matplotlib.
    
    Args:
        graph: NetworkX DiGraph
        nodes_dict: Dictionary mapping node_id to (lat, lon)
        path: Optional list of node IDs representing a path to highlight in red
    """
    plt.ioff()  # Turn off interactive mode to ensure plot displays
    plt.figure(figsize=(12, 12))
    
    # Plot all edges in black
    edge_count = 0
    for u, v in graph.edges():
        if u in nodes_dict and v in nodes_dict:
            lat1, lon1 = nodes_dict[u]
            lat2, lon2 = nodes_dict[v]
            plt.plot([lon1, lon2], [lat1, lat2], 'k-', linewidth=0.5, alpha=0.6)
            edge_count += 1
    
    print(f"Plotted {edge_count} edges")
    
    if edge_count == 0:
        print("Warning: No edges to plot! Check if graph has edges and nodes_dict has coordinates.")
        return
    
    # Plot path in red if provided
    if path and len(path) > 1:
        path_segments = 0
        for i in range(len(path) - 1):
            u, v = path[i], path[i + 1]
            if u in nodes_dict and v in nodes_dict:
                lat1, lon1 = nodes_dict[u]
                lat2, lon2 = nodes_dict[v]
                plt.plot([lon1, lon2], [lat1, lat2], 'r-', linewidth=2, alpha=0.8)
                path_segments += 1
        print(f"Plotted {path_segments} path segments in red")
    
    plt.xlabel("Longitude")
    plt.ylabel("Latitude")
    title = "Fremont Road Graph"
    if path:
        title += " - Shortest Path"
    plt.title(title)
    plt.grid(True, alpha=0.3)
    plt.axis('equal')
    plt.tight_layout()
    print("Displaying plot window...")
    plt.show(block=True)  # Block until window is closed


if __name__ == "__main__":
    import os
    import sys
    # Add parent directory to path for imports
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    # Build graph from Fremont OSM data
    print("Loading OSM data and building graph...")
    osm_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "osm", "fremont_raw.osm")
    graph, nodes_dict = build_graph(osm_path)
    
    # Print statistics
    print(f"Graph nodes: {graph.number_of_nodes()}")
    print(f"Graph edges: {graph.number_of_edges()}")
    
    # Test KD-tree spatial index
    print("\n" + "="*50)
    print("Testing KD-tree spatial index...")
    print("="*50)
    try:
        from core.spatial_index import build_kd_tree, find_nearest_node
        import time
        
        # Build KD-tree
        print("Building KD-tree...")
        start_time = time.time()
        tree, node_ids, coords = build_kd_tree(nodes_dict)
        build_time = (time.time() - start_time) * 1000
        print(f"KD-tree built in {build_time:.2f} ms")
        print(f"Tree contains {len(node_ids)} nodes")
        
        # Test query
        test_lat, test_lon = 37.5483, -121.9886
        print(f"\nQuerying nearest node to ({test_lat}, {test_lon})...")
        
        query_start = time.time()
        nearest = find_nearest_node(test_lat, test_lon, tree, node_ids)
        query_time = (time.time() - query_start) * 1000
        
        print(f"Nearest node: {nearest}")
        if nearest in nodes_dict:
            nearest_lat, nearest_lon = nodes_dict[nearest]
            print(f"Node coordinates: ({nearest_lat}, {nearest_lon})")
            print(f"Query time: {query_time:.3f} ms")
            
            # Verify node exists in graph
            if nearest in graph:
                print(f"✅ Node {nearest} exists in graph")
            else:
                print(f"⚠️  Node {nearest} not in graph (but exists in nodes_dict)")
        else:
            print(f"❌ Node {nearest} not found in nodes_dict")
        
        # Test multiple queries for performance
        print(f"\nTesting multiple queries...")
        test_queries = [
            (37.5483, -121.9886),
            (37.5500, -121.9900),
            (37.5450, -121.9850),
        ]
        query_times = []
        for lat, lon in test_queries:
            q_start = time.time()
            _ = find_nearest_node(lat, lon, tree, node_ids)
            q_time = (time.time() - q_start) * 1000
            query_times.append(q_time)
        
        avg_time = sum(query_times) / len(query_times)
        print(f"Average query time: {avg_time:.3f} ms")
        if avg_time < 1.0:
            print("✅ All queries are fast (<1 ms)")
        else:
            print(f"⚠️  Some queries took >1 ms (avg: {avg_time:.3f} ms)")
            
    except ImportError as e:
        print(f"❌ Could not import spatial_index: {e}")
        print("Make sure scipy is installed: pip install scipy")
    except Exception as e:
        print(f"❌ Error during KD-tree test: {e}")
        import traceback
        traceback.print_exc()
    
    # Integration test: Dijkstra routing
    print("\n" + "="*50)
    print("Testing Dijkstra routing...")
    print("="*50)
    try:
        from core.routing import dijkstra_custom_algorithm
        
        # Select start and end nodes for testing
        node_list = list(graph.nodes())
        if len(node_list) >= 2:
            # Use first node and a node further in the list for testing
            start_node = node_list[0]
            # Try to find a node that's reasonably far but reachable
            end_index = min(5000, len(node_list) - 1)
            end_node = node_list[end_index]
            
            print(f"Start node: {start_node}")
            print(f"End node: {end_node}")
            
            path, distance = dijkstra_custom_algorithm(graph, start_node, end_node)
            
            if path:
                print(f"Path found!")
                print(f"Path length: {len(path)} nodes")
                print(f"Total distance: {distance:.2f} meters ({distance/1000:.2f} km)")
                
                # Test path_to_coordinates conversion
                print("\nTesting path_to_coordinates conversion...")
                coordinates = path_to_coordinates(path, nodes_dict)
                print(f"✅ Converted {len(path)} node IDs to {len(coordinates)} coordinates")
                if len(coordinates) == len(path):
                    print("✅ Output list length matches path length")
                    print(f"First coordinate: {coordinates[0]}")
                    print(f"Last coordinate: {coordinates[-1]}")
                else:
                    print(f"⚠️  Warning: Some nodes were missing from nodes_dict")
                
                # Visualize graph with path
                visualize_graph(graph, nodes_dict, path)
            else:
                print(f"No path found between nodes (unreachable)")
                print("Visualizing graph without path...")
                visualize_graph(graph, nodes_dict)
        else:
            print("Not enough nodes for routing test")
            visualize_graph(graph, nodes_dict)
            
    except ImportError as e:
        print(f"❌ ImportError during Dijkstra test: {e}")
        print("routing module not found, skipping Dijkstra test")
        visualize_graph(graph, nodes_dict)
    except Exception as e:
        print(f"Error during routing test: {e}")
        visualize_graph(graph, nodes_dict)
