import json


def pytest_addoption(parser):
    parser.addoption(
        "--endpoint", action="store", default="all", help="my option: endpoints"
    )


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "endpoint(endpoint): this mark select the test based on endpoint"
    )


def pytest_runtest_setup(item):
    getoption = item.config.getoption("--endpoint").split(",")
    if getoption not in (["all"], [""]):
        endpoint_names = [mark.args[0] for mark in item.iter_markers(name="endpoint")]
        if not endpoint_names or not set(getoption).intersection(set(endpoint_names)):
            pytest.skip("Test skipped because endpoint is {!r}".format(endpoint_names))


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
