"""Optional pytest plugin: deny Python network attempts, including at collection."""
import sys


def _deny_network(event, _args):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
        raise RuntimeError("OFFLINE_NETWORK_DENIED")


def install():
    sys.addaudithook(_deny_network)


def pytest_configure(_config=None, **_kwargs):
    install()
