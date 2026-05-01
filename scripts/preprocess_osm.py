"""
Run this script locally (requires osmium) to generate data/graph_data.json and
data/map_data.json. Commit those files so the Vercel deployment never needs osmium.

Usage: python scripts/preprocess_osm.py
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.graph_builder import (
    build_graph,
    extract_map_data_for_rendering,
    transform_map_data_for_rendering,
)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM_PATH = os.path.join(PROJECT_ROOT, "data", "osm", "fremont_raw.osm")
GRAPH_OUT = os.path.join(PROJECT_ROOT, "data", "graph_data.json")
MAP_OUT = os.path.join(PROJECT_ROOT, "data", "map_data.json")


def main():
    print("Building graph from OSM...")
    graph, nodes_dict = build_graph(OSM_PATH)
    print(f"  {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")

    graph_data = {
        "nodes": {str(nid): list(coords) for nid, coords in nodes_dict.items()},
        "edges": [[u, v, d["weight"]] for u, v, d in graph.edges(data=True)],
    }
    with open(GRAPH_OUT, "w") as f:
        json.dump(graph_data, f)
    size_mb = os.path.getsize(GRAPH_OUT) / 1_000_000
    print(f"  Saved {GRAPH_OUT} ({size_mb:.1f} MB)")

    print("Extracting map data...")
    map_data = extract_map_data_for_rendering(OSM_PATH)

    lats = [lat for lat, lon in map_data["nodes"].values()]
    lons = [lon for lat, lon in map_data["nodes"].values()]
    center_lat = sum(lats) / len(lats)
    center_lon = sum(lons) / len(lons)

    transformed = transform_map_data_for_rendering(map_data, center_lat, center_lon)
    transformed["center"] = list(transformed["center"])

    with open(MAP_OUT, "w") as f:
        json.dump(transformed, f)
    size_mb = os.path.getsize(MAP_OUT) / 1_000_000
    print(f"  Saved {MAP_OUT} ({size_mb:.1f} MB)")

    print("Done. Commit data/graph_data.json and data/map_data.json.")


if __name__ == "__main__":
    main()
