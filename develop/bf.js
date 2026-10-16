// Best-first minimax pseudocode

function explore() {

    let node = root;
    root.alfa = -Infinity;
    root.beta = +Infinity;

    let value;
    let best;
    let bestNotExpanded;


    while (true) {
        if (node.value < node.alfa || node.value > node.beta) {
            delete node.alfa;
            delete node.beta;
            value = node.value;
            node = node.parent;
        } else {
            if (node.type = max) {
                best = max(node.children.filter(n => n.value))
                bestNotExpanded = max(node.children.filter(n => n.children.isEmpty()).map(n => n.value))
            } else {
                best = min(node.children.filter(n => n.value))
                bestNotExpanded = min(node.children.filter(n => n.children.isEmpty()).map(n => n.value))
            }
        }

        if (!best || !bestNotExpanded) {
            node = node.parent;
            value = node.value;
        } else {
            if (node.type = max) {
                bestNotExpanded.alfa=best.value
                bestNotExpanded.beta=node.beta
                node = bestNotExpanded;
                value = best ? best.value : -Infinity
            } else {
                bestNotExpanded.alfa=node.alfa
                bestNotExpanded.beta=best.value
                node = bestNotExpanded;
                value = best ? best.value : +Infinity
            }
        }
    }

    return value; // por devolver algo
}