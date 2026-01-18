function normalizeName(name) {
  return name
    .toUpperCase()
    .normalize("NFD")                 // remove accents
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’\-]/g, " ")          // apostrophes & hyphens
    .replace(/[^A-Z\s]/g, "")         // keep letters only
    .replace(/\s+/g, " ")
    .trim();
}
function tokenize(name) {
  return normalizeName(name).split(" ");
}
function nameScore(inputTokens, candidateTokens) {
  let score = 0;

  for (const token of inputTokens) {
    if (candidateTokens.includes(token)) {
      score += 1;
    }
  }

  return score / Math.max(inputTokens.length, candidateTokens.length);
}

function normalizeFilename(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function findStudentByName(students, inputName, minScore = 0.6) {
  const inputTokens = tokenize(inputName);

  let bestMatch = null;
  let bestScore = 0;
  let index = 0;
  let student_index;

  for (const student of students) {
    const studentTokens = tokenize(student.name);
    const score = nameScore(inputTokens, studentTokens);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = student;
      student_index = index
    }
    index++;
  }

  if (bestScore >= minScore) {
    return {
      student_index: student_index,
      match: bestMatch,
      confidence: Number(bestScore.toFixed(2)),
    };
  }

  return null;
}
function findSimilarFriendGrp(
  target_stundent_index,
  data,
  seat_number,
  grp_name
) {
  let round_count = 1;
  let completeTask = false;
  let similar = [];
  let current_index = target_stundent_index + 1;
  let next;

  while (!completeTask) {
    if (round_count == 1) {
      if (current_index >= data.length) {
        round_count = 2;
        continue;
      }
      next = data[current_index];
      if (
        next.numero.split("_")[0].toUpperCase() ==
        seat_number.split("_")[0].toUpperCase()
      ) {
        if (next.class.toUpperCase() == grp_name.toUpperCase()) {
          similar.push(next);
        }
        current_index++;
      } else {
        round_count = 2;
      }

    } else if (round_count == 2) {

      if (current_index >= target_stundent_index) {
        current_index = target_stundent_index - 1;
      }

      if (current_index < 0) {
        completeTask = true;
        continue;
      }

      next = data[current_index];

      if (
        next.numero.split("_")[0].toUpperCase() ==
        seat_number.split("_")[0].toUpperCase()
      ) {
        if (next.class.toUpperCase() == grp_name.toUpperCase()) {
          similar.push(next);
        }
        current_index--;
      } else {
        completeTask = true;
      }
    }
  }

  return similar;
}


module.exports = { normalizeFilename, findStudentByName,findSimilarFriendGrp };