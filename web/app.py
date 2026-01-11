from flask import Flask, render_template, request, jsonify
import requests
import time
import os
import sys
import math

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.graph_builder import (
    build_graph, 
    path_to_coordinates,
    extract_map_data_for_rendering,
    transform_map_data_for_rendering
)
from core.spatial_index import build_kd_tree, find_nearest_node
from core.routing import dijkstra_custom_algorithm
import networkx as nx

app = Flask(__name__, template_folder='templates', static_folder='static')

# Global variables to store graph data (loaded on startup)
graph = None
nodes_dict = None
kd_tree = None
node_ids_list = None
map_data_cache = None  # Cached map data for 3D rendering
map_center_lat = None  # Map center latitude (for coordinate transformation)
map_center_lon = None  # Map center longitude (for coordinate transformation)


def load_graph_data():
    """Load graph and build KD-tree on server startup."""
    global graph, nodes_dict, kd_tree, node_ids_list, map_data_cache, map_center_lat, map_center_lon
    
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
    
    # Extract map data for 3D rendering (uses existing RoadGraphHandler from graph_builder.py)
    print("Extracting map data for 3D rendering...")
    
    # Use existing RoadGraphHandler - same tested code that built the graph!
    map_data = extract_map_data_for_rendering(osm_path)
    
    # Calculate center point
    if map_data['nodes']:
        lats = [lat for lat, lon in map_data['nodes'].values()]
        lons = [lon for lat, lon in map_data['nodes'].values()]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)
    else:
        center_lat = 37.5483
        center_lon = -121.9886
    
    # Store center coordinates globally for coordinate transformation
    map_center_lat = center_lat
    map_center_lon = center_lon
    
    # Transform to local coordinates
    map_data_cache = transform_map_data_for_rendering(map_data, center_lat, center_lon)
    print(f"✅ Map data cached: {len(map_data_cache['roads'])} road segments, {len(map_data_cache['buildings'])} buildings")
    print(f"✅ Map center: ({map_center_lat:.6f}, {map_center_lon:.6f})")
    
    # Analyze coordinate overlap for debugging (called after map_data_cache is set)
    analyze_coordinate_overlap()


def analyze_coordinate_overlap():
    """Analyze if roads and buildings actually overlap in coordinate space."""
    global map_data_cache
    
    if map_data_cache is None:
        print("⚠️  Cannot analyze coordinate overlap: map_data_cache is not loaded yet")
        return
    
    print("\n" + "="*60)
    print("COMPREHENSIVE COORDINATE ANALYSIS")
    print("="*60)
    
    # Get all road coordinates
    road_xs = []
    road_zs = []
    for road in map_data_cache['roads']:
        for coord in road['coordinates']:
            road_xs.append(coord[0])
            road_zs.append(coord[1])
    
    # Get all building coordinates
    building_xs = []
    building_zs = []
    for building in map_data_cache['buildings']:
        for coord in building['coordinates']:
            building_xs.append(coord[0])
            building_zs.append(coord[1])
    
    print(f"\nROADS ({len(map_data_cache['roads'])} total):")
    print(f"  X range: [{min(road_xs):.1f}, {max(road_xs):.1f}]")
    print(f"  Z range: [{min(road_zs):.1f}, {max(road_zs):.1f}]")
    print(f"  Total points: {len(road_xs)}")
    
    print(f"\nBUILDINGS ({len(map_data_cache['buildings'])} total):")
    print(f"  X range: [{min(building_xs):.1f}, {max(building_xs):.1f}]")
    print(f"  Z range: [{min(building_zs):.1f}, {max(building_zs):.1f}]")
    print(f"  Total points: {len(building_xs)}")
    
    # Check for overlap
    road_x_min, road_x_max = min(road_xs), max(road_xs)
    road_z_min, road_z_max = min(road_zs), max(road_zs)
    building_x_min, building_x_max = min(building_xs), max(building_xs)
    building_z_min, building_z_max = min(building_zs), max(building_zs)
    
    x_overlap = not (building_x_max < road_x_min or building_x_min > road_x_max)
    z_overlap = not (building_z_max < road_z_min or building_z_min > road_z_max)
    
    print(f"\nOVERLAP CHECK:")
    print(f"  X overlap: {x_overlap}")
    print(f"  Z overlap: {z_overlap}")
    print(f"  Both overlap: {x_overlap and z_overlap}")
    
    if x_overlap and z_overlap:
        print("\n✅ Roads and buildings DO overlap - they're in the same area")
        print("   This is expected for a city map!")
    else:
        print("\n❌ ERROR: Roads and buildings DON'T overlap!")
        print("   They're in completely different coordinate spaces!")
        print("   This explains why buildings appear 'on roads' - they're actually")
        print("   far apart but rendering in the wrong place.")
    
    # Sample some buildings in different parts of the list
    print(f"\nSAMPLE BUILDING LOCATIONS (checking distribution):")
    sample_indices = [0, len(map_data_cache['buildings'])//4, 
                     len(map_data_cache['buildings'])//2,
                     3*len(map_data_cache['buildings'])//4,
                     len(map_data_cache['buildings'])-1]
    
    for idx in sample_indices:
        if idx < len(map_data_cache['buildings']):
            building = map_data_cache['buildings'][idx]
            first_coord = building['coordinates'][0]
            print(f"  Building {idx}: X={first_coord[0]:.1f}, Z={first_coord[1]:.1f}")
    
    print("="*60 + "\n")

@app.route('/')
def index():
    """Render the main page."""
    return render_template('index.html')


@app.route('/simulator')
def simulator():
    """Render the 3D simulator page."""
    return render_template('simulator.html')


@app.route('/api/map_data')
def get_map_data():
    """
    Get map data (roads and buildings) for 3D rendering.
    Returns cached data in local Cartesian coordinates (meters).
    Uses data already extracted during server startup.
    """
    if map_data_cache is None:
        return jsonify({'error': 'Map data not loaded yet'}), 503
    
    return jsonify(map_data_cache)


@app.route('/api/teleport', methods=['POST'])
def teleport():
    """
    Teleport car to a real-world location (address or lat/lon).
    Returns simulator coordinates (x, y, z) for spawning the car.
    """
    if map_data_cache is None or map_center_lat is None or map_center_lon is None:
        return jsonify({'error': 'Map data not loaded yet'}), 503
    
    data = request.get_json()
    address = data.get('address', '').strip()
    lat = data.get('lat')
    lon = data.get('lon')
    yaw = data.get('yaw', 0.0)  # Optional initial orientation (degrees)
    
    try:
        from core.graph_builder import latlon_to_local_meters
        
        # If address provided, geocode it
        if address:
            def geocode_address(addr):
                url = "https://nominatim.openstreetmap.org/search"
                params = {
                    'q': addr,
                    'format': 'json',
                    'limit': 1,
                    'addressdetails': 1,
                }
                headers = {
                    'User-Agent': 'Fremont-Routing-App/1.0'
                }
                
                import time
                time.sleep(1)  # Rate limiting
                response = requests.get(url, params=params, headers=headers, timeout=5)
                response.raise_for_status()
                
                results = response.json()
                if results:
                    return {
                        'lat': float(results[0]['lat']),
                        'lon': float(results[0]['lon']),
                        'display_name': results[0].get('display_name', addr)
                    }
                return None
            
            geocode_result = geocode_address(address)
            if not geocode_result:
                return jsonify({'error': f'Could not geocode address: {address}'}), 400
            
            lat = geocode_result['lat']
            lon = geocode_result['lon']
            display_name = geocode_result['display_name']
        elif lat is None or lon is None:
            return jsonify({'error': 'Either address or lat/lon must be provided'}), 400
        else:
            try:
                lat = float(lat)
                lon = float(lon)
            except (ValueError, TypeError):
                return jsonify({'error': 'Invalid lat/lon values'}), 400
            display_name = f'{lat:.6f}, {lon:.6f}'
        
        # Validate coordinates are within reasonable bounds (Fremont area)
        if lat < 37.4 or lat > 37.6 or lon < -122.1 or lon > -121.9:
            return jsonify({
                'error': f'Coordinates ({lat:.6f}, {lon:.6f}) are outside Fremont map bounds',
                'bounds': {'lat': [37.4, 37.6], 'lon': [-122.1, -121.9]}
            }), 400
        
        # Find nearest road node using KD-tree
        nearest_node = find_nearest_node(lat, lon, kd_tree, node_ids_list)
        
        # Verify node is in graph
        if nearest_node not in graph:
            return jsonify({'error': f'Nearest node {nearest_node} not in graph. This should not happen.'}), 500
        
        # Get node's lat/lon
        node_lat, node_lon = nodes_dict[nearest_node]
        
        # Convert to simulator coordinates (meters)
        x, z = latlon_to_local_meters(node_lat, node_lon, map_center_lat, map_center_lon)
        y = 1.0  # Road height (meters above ground)
        
        # Convert yaw to radians
        yaw_rad = math.radians(float(yaw))
        
        return jsonify({
            'success': True,
            'address': display_name if address else None,
            'lat': node_lat,
            'lon': node_lon,
            'node_id': nearest_node,
            'position': {
                'x': x,
                'y': y,
                'z': z
            },
            'yaw': float(yaw),
            'yaw_rad': yaw_rad
        })
    
    except Exception as e:
        print(f"Error in teleport: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500



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
        
        # Format waypoints for simulator (list of {lat, lon} objects)
        waypoints = [{'lat': lat, 'lon': lon} for lat, lon in coordinates]
        
        return jsonify({
            'path': path,
            'coordinates': coordinates,
            'waypoints': waypoints,  # Added for simulator autopilot
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

