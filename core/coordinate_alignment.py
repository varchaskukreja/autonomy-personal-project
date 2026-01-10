"""
Coordinate Alignment Analysis

This module provides functions to analyze and determine rotation corrections
needed to align roads and buildings in the rendered map.

Can be easily removed if not needed.
"""

import math
from typing import Dict, List, Tuple, Optional
import numpy as np


def calculate_map_rotation(map_data: Dict, center_lat: float, center_lon: float) -> Optional[float]:
    """
    Calculate the rotation angle (in degrees) needed to align buildings with roads.
    
    The rotation is applied to the entire map (all coordinates rotated around center).
    Positive rotation = counterclockwise, negative = clockwise.
    
    Args:
        map_data: Dictionary with 'roads' and 'buildings' keys
                 Each road/building has 'coordinates' list of (lat, lon) tuples
        center_lat: Center latitude for rotation reference
        center_lon: Center longitude for rotation reference
    
    Returns:
        Rotation angle in degrees (or None if cannot determine)
        Positive = counterclockwise, negative = clockwise
    """
    if not map_data or 'roads' not in map_data or 'buildings' not in map_data:
        return None
    
    if not map_data['roads'] or not map_data['buildings']:
        return None
    
    # Convert lat/lon to local meters
    from core.graph_builder import latlon_to_local_meters
    
    # Get all road points
    road_points = []
    for road in map_data['roads']:
        for lat, lon in road.get('coordinates', []):
            x, z = latlon_to_local_meters(lat, lon, center_lat, center_lon)
            road_points.append((x, z))
    
    # Get all building points
    building_points = []
    for building in map_data['buildings']:
        for lat, lon in building.get('coordinates', []):
            x, z = latlon_to_local_meters(lat, lon, center_lat, center_lon)
            building_points.append((x, z))
    
    if not road_points or not building_points:
        return None
    
    # Convert to numpy arrays for easier computation
    road_arr = np.array(road_points)
    building_arr = np.array(building_points)
    
    # Calculate principal directions using PCA
    # Roads typically align along major axes (north-south, east-west)
    road_pca_angle = calculate_principal_angle(road_arr)
    building_pca_angle = calculate_principal_angle(building_arr)
    
    # Calculate rotation needed to align buildings with roads
    rotation_rad = road_pca_angle - building_pca_angle
    
    # Normalize to [-pi, pi] range
    rotation_rad = ((rotation_rad + math.pi) % (2 * math.pi)) - math.pi
    
    # Convert to degrees
    rotation_deg = math.degrees(rotation_rad)
    
    return rotation_deg


def calculate_principal_angle(points: np.ndarray) -> float:
    """
    Calculate the principal angle of a point cloud using PCA.
    
    Args:
        points: Nx2 array of (x, z) coordinates
    
    Returns:
        Angle in radians of the principal direction
    """
    # Center the points
    centered = points - points.mean(axis=0)
    
    # Calculate covariance matrix
    cov = np.cov(centered.T)
    
    # Eigenvalue decomposition
    eigenvalues, eigenvectors = np.linalg.eig(cov)
    
    # Get the eigenvector corresponding to the largest eigenvalue (principal direction)
    principal_idx = np.argmax(eigenvalues)
    principal_vec = eigenvectors[:, principal_idx]
    
    # Calculate angle from principal vector (normalized to first quadrant)
    angle = math.atan2(principal_vec[1], principal_vec[0])
    
    return angle


def analyze_alignment_offset(map_data: Dict, center_lat: float, center_lon: float) -> Dict:
    """
    Analyze the offset and rotation between roads and buildings.
    
    Args:
        map_data: Dictionary with 'roads' and 'buildings' keys
        center_lat: Center latitude
        center_lon: Center longitude
    
    Returns:
        Dictionary with analysis results including:
        - rotation_degrees: Suggested rotation angle
        - road_principal_angle: Principal direction of roads (degrees)
        - building_principal_angle: Principal direction of buildings (degrees)
        - road_bounds: Bounding box of roads
        - building_bounds: Bounding box of buildings
        - offset: Translation offset between road and building centers
    """
    from core.graph_builder import latlon_to_local_meters
    
    # Get all road points
    road_points = []
    for road in map_data.get('roads', []):
        for lat, lon in road.get('coordinates', []):
            x, z = latlon_to_local_meters(lat, lon, center_lat, center_lon)
            road_points.append((x, z))
    
    # Get all building points
    building_points = []
    for building in map_data.get('buildings', []):
        for lat, lon in building.get('coordinates', []):
            x, z = latlon_to_local_meters(lat, lon, center_lat, center_lon)
            building_points.append((x, z))
    
    if not road_points or not building_points:
        return {'error': 'No roads or buildings found'}
    
    road_arr = np.array(road_points)
    building_arr = np.array(building_points)
    
    # Calculate principal angles
    road_angle = calculate_principal_angle(road_arr)
    building_angle = calculate_principal_angle(building_arr)
    
    # Calculate rotation needed
    rotation_rad = road_angle - building_angle
    rotation_rad = ((rotation_rad + math.pi) % (2 * math.pi)) - math.pi
    rotation_deg = math.degrees(rotation_rad)
    
    # Calculate centers
    road_center = road_arr.mean(axis=0)
    building_center = building_arr.mean(axis=0)
    offset = building_center - road_center
    
    # Calculate bounds
    road_bounds = {
        'min_x': float(road_arr[:, 0].min()),
        'max_x': float(road_arr[:, 0].max()),
        'min_z': float(road_arr[:, 1].min()),
        'max_z': float(road_arr[:, 1].max())
    }
    
    building_bounds = {
        'min_x': float(building_arr[:, 0].min()),
        'max_x': float(building_arr[:, 0].max()),
        'min_z': float(building_arr[:, 1].min()),
        'max_z': float(building_arr[:, 1].max())
    }
    
    return {
        'rotation_degrees': float(rotation_deg),
        'road_principal_angle': math.degrees(road_angle),
        'building_principal_angle': math.degrees(building_angle),
        'road_bounds': road_bounds,
        'building_bounds': building_bounds,
        'road_center': {'x': float(road_center[0]), 'z': float(road_center[1])},
        'building_center': {'x': float(building_center[0]), 'z': float(building_center[1])},
        'offset': {'x': float(offset[0]), 'z': float(offset[1])},
        'road_points_count': len(road_points),
        'building_points_count': len(building_points)
    }


def rotate_coordinates(coords: List[Tuple[float, float]], center_x: float, center_z: float, angle_degrees: float) -> List[Tuple[float, float]]:
    """
    Rotate a list of (x, z) coordinates around a center point.
    
    Args:
        coords: List of (x, z) tuples
        center_x: Rotation center X coordinate
        center_z: Rotation center Z coordinate
        angle_degrees: Rotation angle in degrees (positive = counterclockwise)
    
    Returns:
        List of rotated (x, z) coordinates
    """
    angle_rad = math.radians(angle_degrees)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    
    rotated = []
    for x, z in coords:
        # Translate to origin
        dx = x - center_x
        dz = z - center_z
        
        # Rotate
        rx = dx * cos_a - dz * sin_a
        rz = dx * sin_a + dz * cos_a
        
        # Translate back
        rotated.append((rx + center_x, rz + center_z))
    
    return rotated
