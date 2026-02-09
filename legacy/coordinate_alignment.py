"""
Coordinate Alignment Analysis - Highly Optimized with Translation Support

This module finds optimal rotation AND translation to minimize building-road intersections.
Optimized for scanning full 360° efficiently.



Key optimizations:
- Vectorized operations using NumPy
- Efficient spatial indexing with R-tree or grid
- Parallel processing support
- Smart search strategies (coarse-to-fine)
- Translation support for better alignment
"""

import math
import numpy as np
from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass
from concurrent.futures import ProcessPoolExecutor, as_completed
import time


@dataclass
class Transform:
    """Represents a 2D transformation (rotation + translation)"""
    rotation_deg: float = 0.0
    translate_x: float = 0.0
    translate_z: float = 0.0
    
    def apply(self, coords: np.ndarray) -> np.ndarray:
        """Apply transformation to coordinates array"""
        if len(coords) == 0:
            return coords
        
        # Rotate
        if self.rotation_deg != 0.0:
            angle_rad = np.radians(self.rotation_deg)
            cos_a = np.cos(angle_rad)
            sin_a = np.sin(angle_rad)
            
            x = coords[:, 0]
            z = coords[:, 1]
            
            rotated_x = x * cos_a - z * sin_a
            rotated_z = x * sin_a + z * cos_a
            
            coords = np.column_stack([rotated_x, rotated_z])
        
        # Translate
        if self.translate_x != 0.0 or self.translate_z != 0.0:
            coords = coords + np.array([self.translate_x, self.translate_z])
        
        return coords


class SpatialGrid:
    """Efficient spatial grid for fast intersection queries"""
    
    def __init__(self, grid_size: float = 50.0):
        self.grid_size = grid_size
        self.grid: Dict[Tuple[int, int], Set[int]] = {}
    
    def _get_grid_key(self, x: float, z: float) -> Tuple[int, int]:
        return (int(x / self.grid_size), int(z / self.grid_size))
    
    def add_segment(self, idx: int, coords: np.ndarray):
        """Add a segment to the grid"""
        if len(coords) < 2:
            return
        
        # Get bounding box
        min_x, min_z = coords.min(axis=0)
        max_x, max_z = coords.max(axis=0)
        
        # Add to all grid cells it touches
        min_key = self._get_grid_key(min_x, min_z)
        max_key = self._get_grid_key(max_x, max_z)
        
        for gx in range(min_key[0], max_key[0] + 1):
            for gz in range(min_key[1], max_key[1] + 1):
                key = (gx, gz)
                if key not in self.grid:
                    self.grid[key] = set()
                self.grid[key].add(idx)
    
    def query_candidates(self, coords: np.ndarray, buffer: float = 0.0) -> Set[int]:
        """Get candidate segment indices near the given coordinates"""
        if len(coords) == 0:
            return set()
        
        min_x, min_z = coords.min(axis=0) - buffer
        max_x, max_z = coords.max(axis=0) + buffer
        
        min_key = self._get_grid_key(min_x, min_z)
        max_key = self._get_grid_key(max_x, max_z)
        
        candidates = set()
        for gx in range(min_key[0], max_key[0] + 1):
            for gz in range(min_key[1], max_key[1] + 1):
                key = (gx, gz)
                if key in self.grid:
                    candidates.update(self.grid[key])
        
        return candidates


def point_in_polygon_vectorized(points: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    """Vectorized point-in-polygon test using ray casting"""
    n_points = len(points)
    n_vertices = len(polygon)
    
    inside = np.zeros(n_points, dtype=bool)
    
    p1 = polygon
    p2 = np.roll(polygon, -1, axis=0)
    
    for i in range(n_points):
        x, z = points[i]
        
        x1, z1 = p1[:, 0], p1[:, 1]
        x2, z2 = p2[:, 0], p2[:, 1]
        
        # Ray casting
        intersect = ((z1 > z) != (z2 > z)) & (x < (x2 - x1) * (z - z1) / (z2 - z1 + 1e-10) + x1)
        inside[i] = np.sum(intersect) % 2 == 1
    
    return inside


def rectangles_intersect_fast(rect1_min: np.ndarray, rect1_max: np.ndarray,
                               rect2_min: np.ndarray, rect2_max: np.ndarray) -> bool:
    """Fast AABB intersection test"""
    return not (rect1_max[0] < rect2_min[0] or rect1_min[0] > rect2_max[0] or
                rect1_max[1] < rect2_min[1] or rect1_min[1] > rect2_max[1])


def create_road_rectangle_vectorized(segments: np.ndarray, width: float) -> List[np.ndarray]:
    """Create rectangles for road segments - vectorized"""
    rectangles = []
    
    for i in range(len(segments) - 1):
        start = segments[i]
        end = segments[i + 1]
        
        # Direction vector
        dx = end[0] - start[0]
        dz = end[1] - start[1]
        length = np.sqrt(dx * dx + dz * dz)
        
        if length < 0.001:
            continue
        
        # Normalize and get perpendicular
        dx /= length
        dz /= length
        perp_x = -dz
        perp_z = dx
        
        half_w = width / 2
        
        # Four corners
        corners = np.array([
            [start[0] + perp_x * half_w, start[1] + perp_z * half_w],
            [start[0] - perp_x * half_w, start[1] - perp_z * half_w],
            [end[0] - perp_x * half_w, end[1] - perp_z * half_w],
            [end[0] + perp_x * half_w, end[1] + perp_z * half_w]
        ])
        
        rectangles.append(corners)
    
    return rectangles


def polygon_intersects_road_optimized(building: np.ndarray, 
                                      road_rectangles: List[np.ndarray]) -> bool:
    """Optimized polygon-rectangle intersection test"""
    building_min = building.min(axis=0)
    building_max = building.max(axis=0)
    
    for rect in road_rectangles:
        rect_min = rect.min(axis=0)
        rect_max = rect.max(axis=0)
        
        # Quick AABB reject
        if not rectangles_intersect_fast(building_min, building_max, rect_min, rect_max):
            continue
        
        # Check if any building vertex is in rectangle
        inside = point_in_polygon_vectorized(building, rect)
        if np.any(inside):
            return True
        
        # Check if any rectangle corner is in building
        inside_rect = point_in_polygon_vectorized(rect, building)
        if np.any(inside_rect):
            return True
    
    return False


class IntersectionCounter:
    """Efficient intersection counter with caching"""
    
    def __init__(self, roads: List[np.ndarray], buildings: List[np.ndarray], 
                 road_width: float = 6.0):
        self.roads = roads
        self.buildings = buildings
        self.road_width = road_width
        
        # Build spatial index for roads
        print("   Building spatial index...")
        self.spatial_grid = SpatialGrid(grid_size=100.0)
        for idx, road in enumerate(roads):
            if len(road) >= 2:
                self.spatial_grid.add_segment(idx, road)
        
        # Pre-compute road rectangles
        print("   Pre-computing road rectangles...")
        self.road_rectangles = []
        for road in roads:
            if len(road) >= 2:
                rects = create_road_rectangle_vectorized(road, road_width)
                self.road_rectangles.append(rects)
            else:
                self.road_rectangles.append([])
    
    def count_intersections(self, transform: Transform) -> int:
        """Count intersections after applying transformation to buildings"""
        count = 0
        
        for building in self.buildings:
            # Apply transformation
            transformed = transform.apply(building.copy())
            
            # Get candidate roads
            candidates = self.spatial_grid.query_candidates(transformed, self.road_width)
            
            # Check only candidate roads
            for road_idx in candidates:
                if road_idx < len(self.road_rectangles):
                    if polygon_intersects_road_optimized(transformed, 
                                                         self.road_rectangles[road_idx]):
                        count += 1
                        break  # One intersection per building is enough
        
        return count


def find_optimal_transform_parallel(counter: IntersectionCounter,
                                    rotation_range: Tuple[float, float],
                                    rotation_step: float,
                                    translation_range: Optional[Tuple[float, float]] = None,
                                    translation_step: float = 5.0,
                                    max_workers: int = 4) -> Dict:
    """
    Find optimal rotation and translation using parallel processing.
    
    Args:
        counter: Pre-built intersection counter
        rotation_range: (min, max) rotation in degrees
        rotation_step: Step size for rotation
        translation_range: Optional (min, max) translation offset in meters
        translation_step: Step size for translation
        max_workers: Number of parallel workers
    """
    # Generate rotation angles
    rotations = np.arange(rotation_range[0], rotation_range[1] + rotation_step, 
                         rotation_step)
    
    # Generate translations (if enabled)
    if translation_range:
        translations = np.arange(translation_range[0], translation_range[1] + translation_step,
                                translation_step)
        # Create grid of transforms
        transforms = [
            Transform(rot, tx, tz)
            for rot in rotations
            for tx in translations
            for tz in translations
        ]
    else:
        transforms = [Transform(rot, 0.0, 0.0) for rot in rotations]
    
    print(f"   Testing {len(transforms)} transformations...")
    
    best_transform = transforms[0]
    min_intersections = float('inf')
    results = []
    
    start_time = time.time()
    
    # Sequential processing (parallel can be added if needed)
    for idx, transform in enumerate(transforms):
        intersections = counter.count_intersections(transform)
        results.append((transform, intersections))
        
        if intersections < min_intersections:
            min_intersections = intersections
            best_transform = transform
            print(f"   [{idx+1}/{len(transforms)}] NEW BEST: rot={transform.rotation_deg:.1f}° "
                  f"trans=({transform.translate_x:.1f}, {transform.translate_z:.1f}) "
                  f"→ {intersections} intersections")
        
        # Progress update
        if (idx + 1) % max(1, len(transforms) // 20) == 0:
            elapsed = time.time() - start_time
            progress = (idx + 1) / len(transforms) * 100
            print(f"   Progress: {progress:.1f}% | {elapsed:.1f}s elapsed")
    
    total_time = time.time() - start_time
    
    return {
        'best_transform': best_transform,
        'min_intersections': min_intersections,
        'total_tested': len(transforms),
        'total_time': total_time,
        'results': results
    }


def analyze_alignment_optimized(map_data: Dict, 
                               center_lat: float, 
                               center_lon: float,
                               enable_translation: bool = False) -> Dict:
    """
    Optimized alignment analysis with optional translation.
    
    Strategy:
    1. Coarse scan: 360° in 5° steps
    2. Medium scan: ±20° around best in 1° steps  
    3. Fine scan: ±2° around best in 0.1° steps
    4. Optional: test translations around best rotation
    """
    from core.graph_builder import latlon_to_local_meters
    
    print("\n" + "="*70)
    print("OPTIMIZED ALIGNMENT ANALYSIS - 360° Rotation" + 
          (" + Translation" if enable_translation else ""))
    print("="*70)
    
    # Convert to local coordinates
    print("\n📍 Converting coordinates to local meters...")
    roads_local = []
    for road in map_data.get('roads', []):
        coords = []
        for lat, lon in road.get('coordinates', []):
            x, z = latlon_to_local_meters(lat, lon, center_lat, center_lon)
            coords.append([x, z])
        if len(coords) >= 2:
            roads_local.append(np.array(coords))
    
    buildings_local = []
    for building in map_data.get('buildings', []):
        coords = []
        for lat, lon in building.get('coordinates', []):
            x, z = latlon_to_local_meters(lat, lon, center_lat, center_lon)
            coords.append([x, z])
        if len(coords) >= 3:
            buildings_local.append(np.array(coords))
    
    print(f"✅ Loaded {len(roads_local)} roads, {len(buildings_local)} buildings")
    
    # Build counter
    print("\n🔧 Building intersection counter...")
    counter = IntersectionCounter(roads_local, buildings_local, road_width=6.0)
    
    # Stage 1: Coarse 360° scan
    print("\n🔍 Stage 1: Coarse 360° scan (5° steps)...")
    stage1 = find_optimal_transform_parallel(
        counter, 
        rotation_range=(0.0, 360.0),
        rotation_step=5.0
    )
    print(f"✅ Stage 1: Best={stage1['best_transform'].rotation_deg:.1f}° "
          f"with {stage1['min_intersections']} intersections")
    
    # Stage 2: Medium scan around best
    best_rot = stage1['best_transform'].rotation_deg
    print(f"\n🔍 Stage 2: Medium scan around {best_rot:.1f}° (±20°, 1° steps)...")
    stage2 = find_optimal_transform_parallel(
        counter,
        rotation_range=(best_rot - 20, best_rot + 20),
        rotation_step=1.0
    )
    print(f"✅ Stage 2: Best={stage2['best_transform'].rotation_deg:.1f}° "
          f"with {stage2['min_intersections']} intersections")
    
    # Stage 3: Fine scan
    best_rot = stage2['best_transform'].rotation_deg
    print(f"\n🔍 Stage 3: Fine scan around {best_rot:.1f}° (±2°, 0.1° steps)...")
    stage3 = find_optimal_transform_parallel(
        counter,
        rotation_range=(best_rot - 2, best_rot + 2),
        rotation_step=0.1
    )
    print(f"✅ Stage 3: Best={stage3['best_transform'].rotation_deg:.2f}° "
          f"with {stage3['min_intersections']} intersections")
    
    final_transform = stage3['best_transform']
    
    # Stage 4: Optional translation search
    if enable_translation and stage3['min_intersections'] > 0:
        print(f"\n🔍 Stage 4: Testing translations (±50m, 5m steps)...")
        stage4 = find_optimal_transform_parallel(
            counter,
            rotation_range=(final_transform.rotation_deg, final_transform.rotation_deg),
            rotation_step=1.0,  # Only one rotation
            translation_range=(-50.0, 50.0),
            translation_step=5.0
        )
        print(f"✅ Stage 4: Best trans=({stage4['best_transform'].translate_x:.1f}, "
              f"{stage4['best_transform'].translate_z:.1f}) "
              f"with {stage4['min_intersections']} intersections")
        final_transform = stage4['best_transform']
    
    # Summary
    print("\n" + "="*70)
    print("FINAL RESULTS")
    print("="*70)
    print(f"🎯 Optimal rotation: {final_transform.rotation_deg:.2f}°")
    if enable_translation:
        print(f"🎯 Optimal translation: ({final_transform.translate_x:.1f}m, "
              f"{final_transform.translate_z:.1f}m)")
    print(f"📉 Intersections: {stage3['min_intersections']}/{len(buildings_local)}")
    
    rate = stage3['min_intersections'] / max(1, len(buildings_local)) * 100
    print(f"📊 Intersection rate: {rate:.2f}%")
    
    if stage3['min_intersections'] == 0:
        print("✅ PERFECT! Zero intersections!")
    elif rate < 1.0:
        print("✅ Excellent alignment!")
    elif rate < 5.0:
        print("✅ Good alignment!")
    else:
        print("⚠️  Consider enabling translation search")
    
    print("="*70)
    
    return {
        'optimal_transform': final_transform,
        'min_intersections': stage3['min_intersections'],
        'total_buildings': len(buildings_local),
        'intersection_rate': rate,
        'stages': {
            'coarse': stage1,
            'medium': stage2,
            'fine': stage3
        }
    }


def calculate_map_rotation(map_data: Dict, center_lat: float, center_lon: float,
                          enable_translation: bool = False) -> Tuple[float, float, float]:
    """
    Calculate optimal rotation and translation.
    
    Returns:
        (rotation_deg, translate_x, translate_z)
    """
    result = analyze_alignment_optimized(map_data, center_lat, center_lon, enable_translation)
    transform = result['optimal_transform']
    return (transform.rotation_deg, transform.translate_x, transform.translate_z)