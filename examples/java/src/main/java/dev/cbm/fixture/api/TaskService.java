package dev.cbm.fixture.api;

import dev.cbm.fixture.model.TaskRequest;

public interface TaskService {
  String execute(TaskRequest request);

  String status();
}
