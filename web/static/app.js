// Autocomplete functionality
let autocompleteTimeout = null;

function setupAutocomplete(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const suggestionsDiv = document.getElementById(suggestionsId);
    let selectedIndex = -1;

    input.addEventListener('input', function() {
        const query = this.value.trim();
        
        // Clear previous timeout
        if (autocompleteTimeout) {
            clearTimeout(autocompleteTimeout);
        }

        // Hide suggestions if query is too short
        if (query.length < 3) {
            suggestionsDiv.classList.remove('show');
            return;
        }

        // Debounce API calls
        autocompleteTimeout = setTimeout(() => {
            fetchAutocomplete(query, suggestionsDiv, input);
        }, 300);
    });

    input.addEventListener('keydown', function(e) {
        const items = suggestionsDiv.querySelectorAll('.suggestion-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateSelection(items, selectedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelection(items, selectedIndex);
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            if (items[selectedIndex]) {
                items[selectedIndex].click();
            }
        } else if (e.key === 'Escape') {
            suggestionsDiv.classList.remove('show');
            selectedIndex = -1;
        }
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.classList.remove('show');
        }
    });
}

function updateSelection(items, index) {
    items.forEach((item, i) => {
        if (i === index) {
            item.style.backgroundColor = '#e0e0e0';
        } else {
            item.style.backgroundColor = '';
        }
    });
}

async function fetchAutocomplete(query, suggestionsDiv, input) {
    try {
        const response = await fetch(`/autocomplete?q=${encodeURIComponent(query)}`);
        const suggestions = await response.json();

        if (response.ok && Array.isArray(suggestions)) {
            displaySuggestions(suggestions, suggestionsDiv, input);
        } else {
            suggestionsDiv.classList.remove('show');
        }
    } catch (error) {
        console.error('Autocomplete error:', error);
        suggestionsDiv.classList.remove('show');
    }
}

function displaySuggestions(suggestions, suggestionsDiv, input) {
    suggestionsDiv.innerHTML = '';

    if (suggestions.length === 0) {
        suggestionsDiv.classList.remove('show');
        return;
    }

    suggestions.forEach(suggestion => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = suggestion.display_name;
        
        item.addEventListener('click', function() {
            input.value = suggestion.display_name;
            suggestionsDiv.classList.remove('show');
        });

        suggestionsDiv.appendChild(item);
    });

    suggestionsDiv.classList.add('show');
}

// Form submission and route computation
document.getElementById('routeForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const startAddress = document.getElementById('startAddress').value.trim();
    const endAddress = document.getElementById('endAddress').value.trim();

    if (!startAddress || !endAddress) {
        showError('Please enter both start and end addresses');
        return;
    }

    // Hide previous results and errors
    document.getElementById('results').classList.add('hidden');
    document.getElementById('error').classList.add('hidden', 'show');
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('simulateBtn').disabled = true;

    try {
        // Step 1: Get lat/lon and nearest nodes
        const latlonResponse = await fetch('/get_latlon', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                start_address: startAddress,
                end_address: endAddress
            })
        });

        const latlonData = await latlonResponse.json();

        if (!latlonResponse.ok) {
            throw new Error(latlonData.error || 'Failed to geocode addresses');
        }

        // Step 2: Compute route
        const routeResponse = await fetch('/compute_route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                start_node: latlonData.start.node_id,
                end_node: latlonData.end.node_id
            })
        });

        const routeData = await routeResponse.json();

        if (!routeResponse.ok) {
            throw new Error(routeData.error || 'Failed to compute route');
        }

        // Display results
        displayResults(latlonData, routeData);
        
        // Store route data for simulator autopilot
        if (routeData.waypoints && routeData.waypoints.length > 0) {
            const routePayload = {
                waypoints: routeData.waypoints,
                start_address: startAddress,
                end_address: endAddress,
                distance: routeData.distance,
                num_nodes: routeData.num_nodes
            };
            localStorage.setItem('autopilot_route', JSON.stringify(routePayload));
            console.log('Route stored for autopilot:', routePayload);
        }

    } catch (error) {
        console.error('Route computation error:', error);
        showError(error.message || 'An error occurred while computing the route');
    } finally {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('simulateBtn').disabled = false;
    }
});

function displayResults(latlonData, routeData) {
    const resultsDiv = document.getElementById('results');
    const summaryDiv = document.getElementById('routeSummary');
    const detailsDiv = document.getElementById('routeDetails');
    const statusDiv = document.getElementById('statusMessage');

    // Build summary
    summaryDiv.innerHTML = `
        <div class="route-summary-item">
            <strong>Start:</strong> ${latlonData.start.address}
        </div>
        <div class="route-summary-item">
            <strong>End:</strong> ${latlonData.end.address}
        </div>
        <div class="route-summary-item">
            <strong>Path Nodes:</strong> ${routeData.num_nodes}
        </div>
        <div class="route-summary-item">
            <strong>Total Distance:</strong> ${routeData.distance_km.toFixed(2)} km (${routeData.distance.toFixed(0)} meters)
        </div>
        <div class="route-summary-item">
            <strong>Start Node ID:</strong> ${latlonData.start.node_id}
        </div>
        <div class="route-summary-item">
            <strong>End Node ID:</strong> ${latlonData.end.node_id}
        </div>
    `;

    // Build details
    detailsDiv.innerHTML = `
        <h3>Route Coordinates</h3>
        <p>Path contains ${routeData.coordinates.length} coordinate points</p>
        <details>
            <summary>View all coordinates (${routeData.coordinates.length} points)</summary>
            <pre style="max-height: 300px; overflow-y: auto; background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 10px;">${JSON.stringify(routeData.coordinates, null, 2)}</pre>
        </details>
    `;

    // Status message with simulator launch button
    statusDiv.innerHTML = `
        <strong>✅ Route computed successfully!</strong><br>
        The path contains ${routeData.num_nodes} nodes covering ${routeData.distance_km.toFixed(2)} km.<br><br>
        <button id="launchSimulatorBtn" class="btn-primary" style="margin-top: 10px;">
            🚗 Launch Simulator & Start Autopilot
        </button>
    `;
    
    // Add click handler for simulator launch button
    document.getElementById('launchSimulatorBtn').addEventListener('click', function() {
        window.location.href = '/simulator';
    });

    resultsDiv.classList.remove('hidden');
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = `Error: ${message}`;
    errorDiv.classList.remove('hidden');
    errorDiv.classList.add('show');
}

// Initialize autocomplete for both inputs
setupAutocomplete('startAddress', 'startSuggestions');
setupAutocomplete('endAddress', 'endSuggestions');

