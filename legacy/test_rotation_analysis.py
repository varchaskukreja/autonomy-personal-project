#!/usr/bin/env python3
"""
Test script for optimized coordinate alignment with rotation + translation.

Usage:
    python3 test_rotation_analysis.py                    # Rotation only (fast)
    python3 test_rotation_analysis.py --translation      # Rotation + translation (slower but thorough)
"""

import os
import sys

# Add project root to path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

from core.coordinate_alignment import analyze_alignment_optimized, calculate_map_rotation
from core.graph_builder import extract_map_data_for_rendering


def main():
    # Check if translation mode is requested
    enable_translation = '--translation' in sys.argv or '-t' in sys.argv
    
    print("="*70)
    print("OPTIMIZED MAP ALIGNMENT ANALYSIS")
    if enable_translation:
        print("Mode: ROTATION + TRANSLATION (slower, more thorough)")
    else:
        print("Mode: ROTATION ONLY (faster)")
    print("="*70)
    
    # Load map data
    osm_path = os.path.join(project_root, "data", "osm", "fremont_raw.osm")
    
    if not os.path.exists(osm_path):
        print(f"❌ Error: OSM file not found at {osm_path}")
        print(f"\nTip: Make sure you have the OSM file at: {osm_path}")
        return None
    
    print(f"\n📂 Loading map data from {osm_path}...")
    map_data = extract_map_data_for_rendering(osm_path)
    
    print(f"✅ Loaded {len(map_data['roads'])} roads and {len(map_data['buildings'])} buildings")
    
    # Calculate center point
    if map_data['nodes']:
        lats = [lat for lat, lon in map_data['nodes'].values()]
        lons = [lon for lat, lon in map_data['nodes'].values()]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)
    else:
        # Fallback to Fremont center
        center_lat = 37.5483
        center_lon = -121.9886
    
    print(f"📍 Center point: ({center_lat:.6f}, {center_lon:.6f})")
    
    # Run optimized analysis
    result = analyze_alignment_optimized(map_data, center_lat, center_lon, 
                                        enable_translation=enable_translation)
    
    if 'error' in result:
        print(f"\n❌ Error: {result['error']}")
        return None
    
    # Display final recommendation
    transform = result['optimal_transform']
    
    print(f"\n" + "="*70)
    print("🎯 FINAL RECOMMENDATION")
    print("="*70)
    print(f"Rotation angle: {transform.rotation_deg:.2f}°")
    
    if enable_translation:
        print(f"Translation X:  {transform.translate_x:.2f} meters")
        print(f"Translation Z:  {transform.translate_z:.2f} meters")
    
    print(f"\n📊 Results:")
    print(f"   Intersections: {result['min_intersections']}/{result['total_buildings']} buildings")
    print(f"   Intersection rate: {result['intersection_rate']:.2f}%")
    
    if result['min_intersections'] == 0:
        print("\n✅ PERFECT! Zero building-road intersections!")
    elif result['intersection_rate'] < 1.0:
        print("\n✅ EXCELLENT! Less than 1% intersections!")
    elif result['intersection_rate'] < 5.0:
        print("\n✅ GOOD! Less than 5% intersections!")
    else:
        print(f"\n⚠️  Still {result['intersection_rate']:.1f}% intersections")
        if not enable_translation:
            print("   💡 Try running with --translation flag for better results")
    
    # Show how to use these values
    print(f"\n" + "="*70)
    print("💡 HOW TO USE THESE VALUES")
    print("="*70)
    print(f"\nIn your code, apply this transformation to buildings:")
    print(f"\n# Step 1: Rotate buildings by {transform.rotation_deg:.2f}°")
    print(f"angle_rad = math.radians({transform.rotation_deg:.2f})")
    print(f"rotated_x = x * cos(angle_rad) - z * sin(angle_rad)")
    print(f"rotated_z = x * sin(angle_rad) + z * cos(angle_rad)")
    
    if enable_translation:
        print(f"\n# Step 2: Translate buildings")
        print(f"final_x = rotated_x + {transform.translate_x:.2f}")
        print(f"final_z = rotated_z + {transform.translate_z:.2f}")
    
    print("\n" + "="*70)
    
    # Save results to file
    results_file = os.path.join(project_root, "alignment_results.txt")
    with open(results_file, 'w') as f:
        f.write(f"Optimal Rotation: {transform.rotation_deg:.2f} degrees\n")
        if enable_translation:
            f.write(f"Optimal Translation X: {transform.translate_x:.2f} meters\n")
            f.write(f"Optimal Translation Z: {transform.translate_z:.2f} meters\n")
        f.write(f"Intersections: {result['min_intersections']}/{result['total_buildings']}\n")
        f.write(f"Intersection Rate: {result['intersection_rate']:.2f}%\n")
    
    print(f"💾 Results saved to: {results_file}")
    
    return result


if __name__ == "__main__":
    try:
        print("\n" + "="*70)
        print("Starting alignment analysis...")
        print("="*70)
        
        if '--help' in sys.argv or '-h' in sys.argv:
            print("\nUsage:")
            print("  python3 test_rotation_analysis.py              # Rotation only (fast)")
            print("  python3 test_rotation_analysis.py --translation # Rotation + translation")
            print("  python3 test_rotation_analysis.py -t           # Short form")
            sys.exit(0)
        
        result = main()
        
        if result:
            print("\n✅ Analysis complete!")
            sys.exit(0)
        else:
            print("\n❌ Analysis failed")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n\n⚠️  Analysis interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)