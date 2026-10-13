const node = (id, kind, label) => ({ id, kind, label });
const edge = (id, source, target, label = '', role = 'next') => ({ id, source, target, label, role });

export const sumOdd = {
  id: 'sumOdd-continue', title: 'Сумма нечётных: цикл и continue',
  nodes: [node('n0','terminator','Начало: sumOdd(n)'),node('n1','process','int sum = 0; int i = 0;'),node('n2','decision','i < n'),node('n3','decision','i % 2 == 0'),node('n4','process','continue;'),node('n5','process','sum += i;'),node('n6','process','++i;'),node('n7','process','return sum;'),node('n8','terminator','Конец функции')],
  edges: [edge('e0','n0','n1'),edge('e1','n1','n2'),edge('e2','n2','n3','Да','true'),edge('e3','n2','n7','Нет','false'),edge('e4','n3','n4','Да','true'),edge('e5','n3','n5','Нет','false'),edge('e6','n4','n6','','continue'),edge('e7','n5','n6'),edge('e8','n6','n2','','back'),edge('e9','n7','n8')]
};

export const switchGraph = {
  id: 'switch-fallthrough', title: 'switch: default и fallthrough',
  nodes: [node('n0','terminator','Начало'),node('n1','decision','switch (value)'),node('n2','process','case 1: result = 10;'),node('n3','process','case 2: result += 20;'),node('n4','process','default: result = -1;'),node('n5','io','std::cout << result;'),node('n6','terminator','Конец')],
  edges: [edge('e0','n0','n1'),edge('e1','n1','n2','case 1','case'),edge('e2','n1','n3','case 2','case'),edge('e3','n1','n4','default','default'),edge('e4','n2','n3','fallthrough'),edge('e5','n3','n5'),edge('e6','n4','n5'),edge('e7','n5','n6')]
};

export const nestedBranches = {
  id:'nested-branches',title:'Вложенные ветви с отдельным выходом',
  nodes:[node('n0','terminator','Начало'),node('n1','decision','a > 0 && b != 0'),node('n2','decision','a > b'),node('n3','process','return a;'),node('n4','process','result = b;'),node('n5','decision','a == 0'),node('n6','call','handleZero();'),node('n7','process','result = -a;'),node('n8','io','std::cout << result;'),node('n9','terminator','Конец')],
  edges:[edge('e0','n0','n1'),edge('e1','n1','n2','Да','true'),edge('e2','n1','n5','Нет','false'),edge('e3','n2','n3','Да','true'),edge('e4','n2','n4','Нет','false'),edge('e5','n3','n9'),edge('e6','n4','n8'),edge('e7','n5','n6','Да','true'),edge('e8','n5','n7','Нет','false'),edge('e9','n6','n8'),edge('e10','n7','n8'),edge('e11','n8','n9')]
};

export const longRussian = {
  id:'long-russian',title:'Длинные русские подписи и непрерывный идентификатор',
  nodes:[node('n0','terminator','Начало проверки результата'),node('n1','decision','Проверить, что количество обработанных элементов больше нуля и выбранная конфигурация соответствует сохранённому исходному коду'),node('n2','process','Вычислить итоговую сумму и сохранить подробный результат обработки данных: переменнаяСОченьДлиннымНепрерывнымИдентификаторомДляПроверкиПереносаСтрок = 42;'),node('n3','io','Вывести сообщение: «Нет подходящих элементов». Кириллица: Ёж, съёмка, № 123; кавычки, <, >, &, "текст".'),node('n4','terminator','Конец проверки')],
  edges:[edge('e0','n0','n1'),edge('e1','n1','n2','Да','true'),edge('e2','n1','n3','Нет','false'),edge('e3','n2','n4'),edge('e4','n3','n4')]
};

// Synthetic high-fanout workloads, not claims about C++ semantics.
// The 200-node case intentionally exposes the current compactness/raster gap.
export function workload(count) {
  const nodes=[node('n000','terminator','Начало')], edges=[];
  let previous='n000', serial=1;
  while(serial < count-1) {
    const remaining=count-1-serial;
    const branches=Math.min(8,remaining);
    const branchIds=[];
    for(let b=0;b<branches;b++) {
      const id=`n${String(serial++).padStart(3,'0')}`;
      nodes.push(node(id,'process',`Шаг ${serial-1}: value[${b}] += ${serial};`));
      edges.push(edge(`e${edges.length}`,previous,id)); branchIds.push(id);
    }
    if(serial<count-1) {
      const join=`n${String(serial++).padStart(3,'0')}`;
      nodes.push(node(join,'process',`Объединить этап ${serial-1}`));
      branchIds.forEach(id=>edges.push(edge(`e${edges.length}`,id,join)));
      previous=join;
    } else previous=branchIds;
  }
  const end=`n${String(count-1).padStart(3,'0')}`;
  nodes.push(node(end,'terminator','Конец'));
  for(const id of (Array.isArray(previous)?previous:[previous])) edges.push(edge(`e${edges.length}`,id,end));
  return {id:`workload-${count}`,title:`Синтетическая нагрузка: ${count} блоков`,nodes,edges};
}

export const fixtures=[sumOdd,switchGraph,nestedBranches,longRussian,workload(50),workload(200)];
