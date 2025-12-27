import osmium
import networkx as nx
import numpy as np
import matplotlib.pyplot as plt


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
    
    def __init__(self):
        super().__init__()
        self.nodes = {}  # Store node coordinates: {node_id: (lat, lon)}
        self.highways = []  # Store highway ways: [(node_ids, oneway_tag), ...]
    
    def node(self, n):
        """Store node coordinates by ID."""
        if n.location.valid():
            self.nodes[n.id] = (n.location.lat, n.location.lon)
    
    def way(self, w):
        """Extract ways tagged as highway and track oneway information."""
        if 'highway' in w.tags:
            # Get node IDs for this way
            node_ids = [node.ref for node in w.nodes]
            
            # Check for oneway tag
            oneway = w.tags.get('oneway', 'no')
            
            # Only add if we have at least 2 nodes
            if len(node_ids) >= 2:
                self.highways.append((node_ids, oneway))


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
    for node_ids, oneway in handler.highways:
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


def visualize_graph(graph, nodes_dict):
    """
    Visualize the road graph using matplotlib.
    
    Args:
        graph: NetworkX DiGraph
        nodes_dict: Dictionary mapping node_id to (lat, lon)
    """
    plt.ioff()  # Turn off interactive mode to ensure plot displays
    plt.figure(figsize=(12, 12))
    
    # Plot all edges
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
    
    plt.xlabel("Longitude")
    plt.ylabel("Latitude")
    plt.title("Fremont Road Graph")
    plt.grid(True, alpha=0.3)
    plt.axis('equal')
    plt.tight_layout()
    print("Displaying plot window...")
    plt.show(block=True)  # Block until window is closed


if __name__ == "__main__":
    # Build graph from Fremont OSM data
    print("Loading OSM data and building graph...")
    graph, nodes_dict = build_graph("fremont_raw.osm")
    
    # Print statistics
    print(f"Graph nodes: {graph.number_of_nodes()}")
    print(f"Graph edges: {graph.number_of_edges()}")
    
    # Optional: visualize the graph
    # Uncomment the line below to visualize
    visualize_graph(graph, nodes_dict)

