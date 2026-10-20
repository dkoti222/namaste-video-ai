Explain binary search to a beginner in English. Seven scenes, 155–175 spoken words total, 60–90 seconds. Use Daniel.

Use this exact example throughout: sorted ascending unique values [2,4,6,8,10,12,14], target 10. Keep this exact array in every binary-search scene. Renderer uses lower midpoint (floor). Computed steps:
0: indices 0..6, middle index 3, value 8; 10 is larger, discard indices 0..3, retain 4..6.
1: indices 4..6, middle index 5, value 12; 10 is smaller, discard indices 5..6, retain 4..4.
2: index 4, value 10, match found.

Scenes: introduction using setup, sorted-input requirement using setup, compare step 0, compare step 1, compare step 2, result step 2, takeaway using flow.
Each compare scene needs a main cue exactly at the spoken midpoint value, and a later decisionCue at the spoken discard direction or match confirmation. Refer to values, not indices, in narration. All values in narration should be spoken words, including ten and twelve.

Reference facts:
- Binary search requires sorted data and efficient access to the middle value.
- Compare the target to the middle item; keep only the side that can still contain it. Discard the checked midpoint after an unequal comparison.
- If target equals the midpoint, stop. If the remaining interval becomes empty, the target is absent.
- This example needs three midpoint comparisons. Do not suggest the method always needs exactly three.
- Each unsuccessful comparison roughly halves the candidate range. Sorting itself is separate work; don't suggest binary search automatically sorts data.
- No invented speed ratios or other numbers. Explain clearly, without claiming a CPU performs the illustrated operations literally.
