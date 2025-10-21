#!/usr/bin/env python3

from setuptools import setup, find_packages

setup(
    name="hivemind-cli",
    version="1.0.0",
    description="Hivemind-Prism CLI for submitting code analysis missions",
    packages=find_packages(),
    install_requires=[
        "boto3>=1.26.0",
        "click>=8.0.0",
        "rich>=12.0.0",
    ],
    entry_points={
        "console_scripts": [
            "hivemind=hivemind_cli.cli:main",
        ],
    },
    python_requires=">=3.8",
)