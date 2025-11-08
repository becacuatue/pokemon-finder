 async function search(){
    const pokemonName = document.getElementById("pokemonName").value.toLowerCase();
    let response = await fetch(`https://pokeapi.co/api/v2/pokemon/${pokemonName}`);
    let data = await response.json();
    document.getElementById("pokemonImageBack").src = data.sprites.back_default;
    document.getElementById("pokemonImage").src = data.sprites.front_default;
    document.getElementById("ability").innerHTML = data.abilities.ability.name;
 }