# This is a script to code Dijkstra's algorithm to find the shortest traveling path for a car to travel

import heapq
import math
import networkx as nx
from typing import Tuple, List


def dijkstra_custom_algorithm(
    graph: nx.DiGraph,
    start: int,
    goal: int
) -> Tuple[List[int], float]:
    """
    Compute shortest path using Dijkstra's algorithm.
    
    This implementation uses a priority queue (heap) for efficient node selection
    and handles unreachable destinations gracefully.
    
    Args:
        graph: NetworkX DiGraph with edge weights
        start: Starting node ID
        goal: Destination node ID
    
    Returns:
        tuple: (path, total_distance) where:
            path: list of node IDs from start to goal (empty if unreachable)
            total_distance: total path distance in meters (inf if unreachable)
    
    Raises:
        ValueError: If start or goal node is not in the graph
    """
    # Safety checks: verify nodes exist in graph
    if start not in graph:
        raise ValueError(f"Start node {start} not in graph")
    if goal not in graph:
        raise ValueError(f"Goal node {goal} not in graph")
    
    # Early return if start == goal
    if start == goal:
        return [start], 0.0
    
    # Initialize distance map: node -> distance from start
    dist = {node: math.inf for node in graph.nodes()}
    dist[start] = 0.0
    
    # Initialize previous map: node -> predecessor node
    prev = {node: None for node in graph.nodes()}
    
    # Priority queue: (distance, node_id)
    # Using heap for O(log n) insertions and O(log n) minimum extraction
    pq = [(0.0, start)]
    
    # Main Dijkstra loop
    while pq:
        # Extract node with minimum distance
        current_dist, u = heapq.heappop(pq)
        
        # Skip if we've already processed this node with a better distance
        # This handles duplicate entries in the priority queue
        if current_dist > dist[u]:
            continue
        
        # Early termination: reached goal
        if u == goal:
            break
        
        # Explore all neighbors
        for v in graph.successors(u):
            # Get edge weight
            try:
                edge_weight = graph[u][v]["weight"]
            except KeyError:
                # Edge doesn't exist (shouldn't happen with successors, but be safe)
                continue
            
            # Calculate alternative distance
            alt = current_dist + edge_weight
            
            # If we found a shorter path, update
            if alt < dist[v]:
                dist[v] = alt
                prev[v] = u
                heapq.heappush(pq, (alt, v))
    
    # Check if goal is reachable
    if dist[goal] == math.inf:
        return [], math.inf
    
    # Reconstruct path from goal to start
    path = []
    curr = goal
    while curr is not None:
        path.append(curr)
        curr = prev[curr]
    
    # Reverse to get path from start to goal
    path.reverse()
    
    return path, dist[goal]

