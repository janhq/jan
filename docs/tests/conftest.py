import json


def pytest_collection_modifyitems(items):
    # load the JSON file
    with open("tests/endpoints_mapping.json", "r") as json_file:
        endpoints_file_mapping = json.load(json_file)

    # create a dictionary to map filenames to endpoints
    filename_to_endpoint = {}
    for endpoint, files in endpoints_file_mapping.items():
        for filename in files:
            filename_to_endpoint[filename] = endpoint

    # add the markers based on the JSON file
    for item in items:
        # map the name of the file to endpoint, else use default value
        filename = item.fspath.basename
        marker = filename_to_endpoint.get(filename, filename)
        item.add_marker(pytest.mark.endpoint(marker, filename=filename))
