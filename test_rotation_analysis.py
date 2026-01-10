#!/usr/bin/env python3
"""
Test script for coordinate alignment analysis.

Usage:
    python3 test_rotation_analysis.py

This will analyze the map data and suggest a rotation angle to align buildings with roads.
"""

import os
import sys

# Add project root to path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

from core.coordinate_alignment import analyze_alignment_offset, calculate_map_rotation
from core.graph_builder import extract_map_data_for_rendering

def main():
    print("="*60)
    print("MAP ROTATION ANALYSIS")
    print("="*60)
    
    # Load map data
    osm_path = os.path.join(project_root, "data", "osm", "fremont_raw.osm")
    
    if not os.path.exists(osm_path):
        print(f"❌ Error: OSM file not found at {osm_path}")
        return
    
    print(f"\nLoading map data from {osm_path}...")
    map_data = extract_map_data_for_rendering(osm_path)
    
    print(f"✅ Loaded {len(map_data['roads'])} roads and {len(map_data['buildings'])} buildings")
    
    # Calculate center point
    if map_data['nodes']:
        lats = [lat for lat, lon in map_data['nodes'].values()]
        lons = [lon for lat, lon in map_data['nodes'].values()]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)
    else:
        center_lat = 37.5483
        center_lon = -121.9886
    
    print(f"\nCenter point: ({center_lat:.6f}, {center_lon:.6f})")
    
    # Analyze alignment
    print("\nAnalyzing alignment...")
    result = analyze_alignment_offset(map_data, center_lat, center_lon)
    
    if 'error' in result:
        print(f"❌ Error: {result['error']}")
        return
    
    # Display results
    print("\n" + "="*60)
    print("ALIGNMENT ANALYSIS RESULTS")
    print("="*60)
    
    print(f"\n📍 Suggested Rotation: {result['rotation_degrees']:.2f} degrees")
    if result['rotation_degrees'] > 0:
        print(f"   (Counterclockwise rotation)")
    else:
        print(f"   (Clockwise rotation)")
    
    print(f"\n📐 Principal Angles:")
    print(f"   Roads: {result['road_principal_angle']:.2f}°")
    print(f"   Buildings: {result['building_principal_angle']:.2f}°")
    
    print(f"\n📍 Centers:")
    print(f"   Road center: ({result['road_center']['x']:.1f}, {result['road_center']['z']:.1f}) meters")
    print(f"   Building center: ({result['building_center']['x']:.1f}, {result['building_center']['z']:.1f}) meters")
    
    print(f"\n📏 Offset:")
    print(f"   X offset: {result['offset']['x']:.1f} meters")
    print(f"   Z offset: {result['offset']['z']:.1f} meters")
    
    print(f"\n📦 Bounds:")
    print(f"   Roads:")
    print(f"     X: [{result['road_bounds']['min_x']:.1f}, {result['road_bounds']['max_x']:.1f}]")
    print(f"     Z: [{result['road_bounds']['min_z']:.1f}, {result['road_bounds']['max_z']:.1f}]")
    print(f"   Buildings:")
    print(f"     X: [{result['building_bounds']['min_x']:.1f}, {result['building_bounds']['max_x']:.1f}]")
    print(f"     Z: [{result['building_bounds']['min_z']:.1f}, {result['building_bounds']['max_z']:.1f}]")
    
    print(f"\n📊 Statistics:")
    print(f"   Road points: {result['road_points_count']}")
    print(f"   Building points: {result['building_points_count']}")
    
    print("\n" + "="*60)
    print(f"✅ Recommended rotation: {result['rotation_degrees']:.2f} degrees")
    print("="*60)
    
    # Also try the simpler function
    simple_rotation = calculate_map_rotation(map_data, center_lat, center_lon)
    if simple_rotation is not None:
        print(f"\nSimplified calculation: {simple_rotation:.2f} degrees")
    
    return result


if __name__ == "__main__":
    try:
        result = main()
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
