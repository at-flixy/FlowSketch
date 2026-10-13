// Кириллица: сумма нечётных
int sumOdd(int n) {
    int s = 0;
    for (int i = 1; i <= n; ++i) {
        if (i % 2 == 0) continue;
        s += i;
    }
    return s;
}
int twice(int n) { return n * 2; }
