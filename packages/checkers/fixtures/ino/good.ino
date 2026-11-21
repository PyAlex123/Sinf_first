// Мигаем светодиодом
#define LED 13
const int BUTTON = 2;

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(BUTTON, INPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(LED, HIGH); /* включить */
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
  Serial.println("blink(); {"); // скобки в строке не считаются
}
