from scipy.spatial import KDTree
import numpy as np

#has the KD-tree & finding the nearest node


"""
Implements a custom Dijkstra shortest‑path algorithm over the road graph.
 It is imported and used by app.py, so it’s part of the final runtime.
"""

def build_kd_tree(nodes_dict):
    """
    Build a KD-tree from node coordinates.

    Args:
        nodes_dict: {node_id: (lat, lon)}

    Returns:
        tree: KDTree object
        node_ids: list mapping tree index -> node_id
        coords: numpy array of shape (N, 2)
    """
    node_ids = []
    coords = []

    for node_id, (lat, lon) in nodes_dict.items():
        node_ids.append(node_id)
        coords.append((lat, lon))

    coords = np.array(coords)
    tree = KDTree(coords)

    return tree, node_ids, coords


def find_nearest_node(lat, lon, tree, node_ids):
    """
    Find the nearest graph node to a given lat/lon.

    Args:
        lat, lon: float (latitude and longitude in degrees)
        tree: KDTree object
        node_ids: list mapping index -> node_id

    Returns:
        nearest_node_id: int (the node ID of the nearest node)
    """
    _, idx = tree.query((lat, lon))
    return node_ids[idx]


if __name__ == "__main__":
    import os
    import sys
    # Add parent directory to path for imports
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    # Standalone test
    from core.graph_builder import build_graph
    
    print("Building graph...")
    osm_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "osm", "fremont_raw.osm")
    graph, nodes_dict = build_graph(osm_path)
    
    print("Building KD-tree...")
    tree, node_ids, _ = build_kd_tree(nodes_dict)
    
    # Test query
    test_lat, test_lon = 37.5483, -121.9886
    nearest = find_nearest_node(test_lat, test_lon, tree, node_ids)
    
    print(f"Nearest node: {nearest}")
    print(f"Node coords: {nodes_dict[nearest]}")
    
    # Verify node exists in graph
    if nearest in graph:
        print(f"✅ Node {nearest} exists in graph")
    else:
        print(f"⚠️  Node {nearest} not in graph")

