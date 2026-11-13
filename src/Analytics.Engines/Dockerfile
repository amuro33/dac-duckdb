FROM apache/spark:4.2.1-scala2.13-java21-python3-ubuntu
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/engine-venv
COPY src/Analytics.Engines/requirements.txt /tmp/requirements.txt
RUN /opt/engine-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app
COPY src/Analytics.Engines/ /app/
ENV PATH=/opt/engine-venv/bin:$PATH PYTHONPATH=/opt/spark/python PYSPARK_PYTHON=/opt/engine-venv/bin/python
ENV ENGINE_ROOT=/engine-data
RUN mkdir -p /engine-data && chown -R 185:185 /engine-data /app
USER 185
EXPOSE 8095
ENTRYPOINT ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8095"]
