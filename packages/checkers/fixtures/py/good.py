# Считаем сумму чисел
def total(numbers):
    s = 0
    for n in numbers:
        if n > 0:
            s += n
    return s


name = input("Как тебя зовут? ")
numbers = [3, 5, -2, 7]
print(f"Привет, {name}!")
print("Сумма:",
      total(numbers))
while False:
    pass
text = """многострочная
строка: for x in y"""
