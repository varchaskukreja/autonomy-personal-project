import osmium
import matplotlib.pyplot as plt


class MapHandler(osmium.SimpleHandler):
    """Handler to extract roads and buildings from OSM data."""
    
    def __init__(self):
        super().__init__()
        self.nodes = {}  # Store node coordinates by ID
        self.highways = []  # Store highway ways as lists of node IDs
        self.buildings = []  # Store building ways as lists of node IDs
        self.highway_node_ids = []  # Store node ID lists for highways
        self.building_node_ids = []  # Store node ID lists for buildings
    
    def node(self, n):
        """Store node coordinates."""
        self.nodes[n.id] = (n.location.lon, n.location.lat)
    
    def way(self, w):
        """Extract ways tagged as highway or building."""
        # Get node IDs for this way
        node_ids = [node.ref for node in w.nodes]
        
        if 'highway' in w.tags:
            self.highway_node_ids.append(node_ids)
        if 'building' in w.tags:
            self.building_node_ids.append(node_ids)
    
    def get_highway_coordinates(self):
        """Convert highway node IDs to coordinates."""
        highways = []
        for node_ids in self.highway_node_ids:
            coords = []
            for node_id in node_ids:
                if node_id in self.nodes:
                    coords.append(self.nodes[node_id])
            if len(coords) > 1:  # Only add if we have at least 2 points
                highways.append(coords)
        return highways
    
    def get_building_coordinates(self):
        """Convert building node IDs to coordinates."""
        buildings = []
        for node_ids in self.building_node_ids:
            coords = []
            for node_id in node_ids:
                if node_id in self.nodes:
                    coords.append(self.nodes[node_id])
            if len(coords) > 2:  # Only add if we have at least 3 points (polygon)
                buildings.append(coords)
        return buildings


def main():
    # Load Fremont OSM data
    print("Loading OSM data...")
    handler = MapHandler()
    handler.apply_file("fremont_raw.osm")
    
    # Extract coordinates
    print("Extracting roads and buildings...")
    highways = handler.get_highway_coordinates()
    buildings = handler.get_building_coordinates()
    
    print(f"Found {len(highways)} road segments")
    print(f"Found {len(buildings)} buildings")
    
    # Plot
    print("Creating plot...")
    plt.figure(figsize=(12, 12))
    
    # Plot buildings first (so they appear behind roads)
    for building in buildings:
        if len(building) > 0:
            lons, lats = zip(*building)
            plt.fill(lons, lats, color='lightgray', edgecolor='gray', linewidth=0.5)
    
    # Plot roads on top
    for highway in highways:
        if len(highway) > 0:
            lons, lats = zip(*highway)
            plt.plot(lons, lats, color='black', linewidth=0.5)
    
    plt.xlabel("Longitude")
    plt.ylabel("Latitude")
    plt.title("Fremont Roads & Buildings")
    plt.grid(True, alpha=0.3)
    plt.axis('equal')
    plt.tight_layout()
    
    print("Displaying plot...")
    plt.show()


if __name__ == "__main__":
    main()

