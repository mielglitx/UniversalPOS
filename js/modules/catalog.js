export const Catalog = {
  items: [
    { id: "P1", name: "Iced Americano", price: 110, cat: "drinks", bc: "1001" },
    { id: "P2", name: "Cafe Latte", price: 130, cat: "drinks", bc: "1002" },
    { id: "P3", name: "Pork Sisig Rice", price: 165, cat: "food", bc: "1003" },
    { id: "P4", name: "Choco Crinkles", price: 75, cat: "food", bc: "1004" }
  ],
  byCat(cat) {
    return cat === "all" ? this.items : this.items.filter(i => i.cat === cat);
  },
  byBc(bc) {
    return this.items.find(i => i.bc === bc);
  }
};