ARG UBUNTU_VERSION=22.04

FROM ubuntu:$UBUNTU_VERSION as build

RUN apt-get update && apt-get install -y build-essential git cmake

WORKDIR /sd.cpp

COPY sd_cpp /sd.cpp

RUN mkdir build && cd build && cmake .. && cmake --build . --config Release

FROM python:3.9.17 as runtime

COPY --from=build /sd.cpp/build/bin/sd /sd

WORKDIR /serving

COPY . /serving/

RUN pip install -r inference.requirements.txt