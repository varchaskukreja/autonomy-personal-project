from flask import Flask, render_template, request, jsonify
import requests
import time
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.graph_builder import build_graph, path_to_coordinates
from core.spatial_index import build_kd_tree, find_nearest_node
from core.routing import dijkstra_custom_algorithm
import networkx as nx

app = Flask(__name__, template_folder='templates', static_folder='static')

# Global variables to store graph data (loaded on startup)
graph = None
nodes_dict = None
kd_tree = None
node_ids_list = None


def load_graph_data():
    """Load graph and build KD-tree on server startup."""
    global graph, nodes_dict, kd_tree, node_ids_list
    
    print("Loading OSM data and building graph...")
    # Get path to OSM file relative to project root
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    osm_path = os.path.join(project_root, "data", "osm", "fremont_raw.osm")
    graph, nodes_dict = build_graph(osm_path)
    
    print("Building KD-tree from graph nodes only...")
    # Only include nodes that are actually in the graph (part of highway ways)
    graph_nodes_dict = {node_id: nodes_dict[node_id] for node_id in graph.nodes() if node_id in nodes_dict}
    kd_tree, node_ids_list, _ = build_kd_tree(graph_nodes_dict)
    
    print(f"✅ Graph loaded: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")
    print(f"✅ KD-tree built: {len(node_ids_list)} nodes indexed (only graph nodes)")


@app.route('/')
def index():
    """Render the main page."""
    return render_template('index.html')


@app.route('/simulator')
def simulator():
    """Render the 3D simulator page."""
    return render_template('simulator.html')


@app.route('/autocomplete', methods=['GET'])
def autocomplete():
    """
    Autocomplete endpoint using Nominatim API.
    Returns address suggestions based on partial input.
    """
    query = request.args.get('q', '').strip()
    
    if not query or len(query) < 3:
        return jsonify([])
    
    # Rate limiting: Nominatim allows 1 request per second
    time.sleep(1)
    
    try:
        # Use Nominatim API for autocomplete
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            'q': query,
            'format': 'json',
            'limit': 5,
            'addressdetails': 1,
            'countrycodes': 'us',  # Limit to US for better Fremont results
        }
        headers = {
            'User-Agent': 'Fremont-Routing-App/1.0'  # Required by Nominatim
        }
        
        response = requests.get(url, params=params, headers=headers, timeout=5)
        response.raise_for_status()
        
        data = response.json()
        
        # Format results for frontend
        suggestions = []
        for item in data:
            suggestions.append({
                'display_name': item.get('display_name', ''),
                'lat': float(item.get('lat', 0)),
                'lon': float(item.get('lon', 0))
            })
        
        return jsonify(suggestions)
    
    except requests.RequestException as e:
        print(f"Error in autocomplete: {e}")
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        print(f"Unexpected error in autocomplete: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/get_latlon', methods=['POST'])
def get_latlon():
    """
    Convert address to latitude/longitude and find nearest graph nodes.
    """
    data = request.get_json()
    start_address = data.get('start_address', '')
    end_address = data.get('end_address', '')
    
    if not start_address or not end_address:
        return jsonify({'error': 'Both start and end addresses are required'}), 400
    
    try:
        # Geocode addresses using Nominatim
        def geocode_address(address):
            url = "https://nominatim.openstreetmap.org/search"
            params = {
                'q': address,
                'format': 'json',
                'limit': 1,
                'addressdetails': 1,
            }
            headers = {
                'User-Agent': 'Fremont-Routing-App/1.0'
            }
            
            time.sleep(1)  # Rate limiting
            response = requests.get(url, params=params, headers=headers, timeout=5)
            response.raise_for_status()
            
            results = response.json()
            if results:
                return {
                    'lat': float(results[0]['lat']),
                    'lon': float(results[0]['lon']),
                    'display_name': results[0].get('display_name', address)
                }
            return None
        
        # Geocode both addresses
        start_geo = geocode_address(start_address)
        end_geo = geocode_address(end_address)
        
        if not start_geo:
            return jsonify({'error': f'Could not geocode start address: {start_address}'}), 400
        if not end_geo:
            return jsonify({'error': f'Could not geocode end address: {end_address}'}), 400
        
        # Find nearest nodes using KD-tree
        start_node = find_nearest_node(start_geo['lat'], start_geo['lon'], kd_tree, node_ids_list)
        end_node = find_nearest_node(end_geo['lat'], end_geo['lon'], kd_tree, node_ids_list)
        
        # Verify nodes are in graph (should always be true now, but safety check)
        if start_node not in graph:
            return jsonify({'error': f'Start node {start_node} not in graph. This should not happen - please report this issue.'}), 500
        if end_node not in graph:
            return jsonify({'error': f'End node {end_node} not in graph. This should not happen - please report this issue.'}), 500
        
        # Get node coordinates
        start_node_coords = nodes_dict.get(start_node)
        end_node_coords = nodes_dict.get(end_node)
        
        return jsonify({
            'start': {
                'address': start_geo['display_name'],
                'lat': start_geo['lat'],
                'lon': start_geo['lon'],
                'node_id': start_node,
                'node_coords': start_node_coords
            },
            'end': {
                'address': end_geo['display_name'],
                'lat': end_geo['lat'],
                'lon': end_geo['lon'],
                'node_id': end_node,
                'node_coords': end_node_coords
            }
        })
    
    except Exception as e:
        print(f"Error in get_latlon: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/compute_route', methods=['POST'])
def compute_route():
    """
    Compute shortest path using Dijkstra's algorithm.
    """
    data = request.get_json()
    start_node = data.get('start_node')
    end_node = data.get('end_node')
    
    if start_node is None or end_node is None:
        return jsonify({'error': 'Both start_node and end_node are required'}), 400
    
    try:
        # Run Dijkstra's algorithm
        path, distance = dijkstra_custom_algorithm(graph, start_node, end_node)
        
        if not path:
            return jsonify({
                'error': 'No path found between the selected nodes',
                'path': [],
                'distance': float('inf')
            }), 404
        
        # Convert path to coordinates
        coordinates = path_to_coordinates(path, nodes_dict)
        
        return jsonify({
            'path': path,
            'coordinates': coordinates,
            'distance': distance,
            'distance_km': distance / 1000.0,
            'num_nodes': len(path),
            'status': 'success'
        })
    
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in compute_route: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Load graph data on startup
    load_graph_data()
    
    # Run Flask app
    print("\n" + "="*50)
    print("Starting Flask server...")
    print("="*50)
    print("Open http://127.0.0.1:5000 in your browser")
    print("="*50 + "\n")
    
    app.run(debug=True, host='0.0.0.0', port=5000)

