def pytest_collection_modifyitems(items):
    for item in items:
        # add the name of the file (without extension) as a marker
        filename = item.nodeid.split("::")[0].split("/")[-1].replace(".py", "")
        marker = pytest.mark.file(filename)
        item.add_marker(marker)
