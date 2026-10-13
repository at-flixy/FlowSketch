int sumOdd(int n) {
  int s = 0;
  for (int i = 1; i <= n; ++i) {
    if (i % 2 == 0) continue;
    s += i;
  }
  return s;
}
