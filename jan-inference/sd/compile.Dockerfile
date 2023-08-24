FROM python:3.9.17

RUN curl https://sh.rustup.rs -sSf | bash -s -- -y
ENV PATH=/root/.cargo/bin:$PATH

WORKDIR /sd.cpp

COPY . .

RUN pip install -r compile.requirements.txt
